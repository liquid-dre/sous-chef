import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * The recommendations list, end to end.
 *
 * The ranking arithmetic is proved in convex/lib/recommendations.test.ts. What
 * is proved here is that the right ROWS reach it — the right windows, the
 * right kitchen, nobody who should not see costs at all — and that the one-tap
 * actions do what the cards say they do.
 */

const OWNER = {
  subject: "user_owner",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:admin",
};
const STAFF = { ...OWNER, subject: "user_staff", org_role: "org:member" };
const SLUG = { orgSlug: "kitchen-a" };
const DAY = "2026-08-04";
const MS_DAY = 86_400_000;

beforeEach(() => {
  // Only Date is faked: convex-test's scheduler needs real timers, and the
  // dormancy and staleness windows compare a real clock against domain days.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
  vi.unstubAllEnvs();
});
afterEach(() => vi.useRealTimers());

function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_DAY)
    .toISOString()
    .slice(0, 10);
}

async function kitchen() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  await t.withIdentity({ subject: "user_super" }).mutation(api.admin.provisionOrg, {
    orgId: "org_kitchen_a",
    slug: "kitchen-a",
    name: "Rutendo's Kitchen",
  });
  await t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
    ...SLUG,
    overheadRateCentsPerHour: 800,
    deliveryFeeModel: "flat",
    deliveryFeeConfig: { flatCents: 500 },
    targetNetMarginPercent: 35,
  });
  return t;
}

/**
 * Brownies at $3.00: 500g of flour a batch at 185c/1000g = 92.5c over 12 = 8c,
 * plus a 20c box, plus 800c/hr for an hour over 12 = 67c. 95c the unit, so
 * gross is (300 − 28)/300 = 90% and the 92% target sits just above it.
 */
async function menu(
  t: ReturnType<typeof convexTest>,
  over: { targetGrossMarginPercent?: number | null; baseBatchYield?: number } = {},
) {
  const flour = await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: "org_kitchen_a",
      name: "Flour",
      baseUnit: "g" as const,
      standardCostCentsPerThousand: 185,
      standardCostSetAt: Date.now(),
      trackStock: true,
      alertsMuted: false,
    }),
  );
  const { menuItemId } = await t.withIdentity(OWNER).mutation(api.menuItems.save, {
    ...SLUG,
    name: "Brownies",
    notSoldDirectly: false,
    baseBatchYield: over.baseBatchYield ?? 12,
    unitWeightMilligrams: 85_000,
    batchProductionMinutes: 60,
    perUnitExtras: [{ label: "Box", costCents: 20 }],
    priceCents: 300,
    targetGrossMarginPercent: over.targetGrossMarginPercent ?? undefined,
    shelfLifeHours: 72,
    lines: [
      {
        componentType: "ingredient" as const,
        componentId: flour,
        qtyMilli: 500_000,
        unit: "g" as const,
      },
    ],
  });
  return { brownie: menuItemId as Id<"menuItems">, flour };
}

async function anOrder(
  t: ReturnType<typeof convexTest>,
  brownie: Id<"menuItems">,
  over: { deliveryDate?: string; units?: number } = {},
) {
  const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
    ...SLUG,
    phone: "+263715550184",
    name: "Tariro Moyo",
    orderDate: over.deliveryDate ?? DAY,
    deliveryDate: over.deliveryDate ?? DAY,
    lines: [{ menuItemId: brownie, qtyMilli: (over.units ?? 10) * 1000 }],
  });
  return orderId;
}

const list = (t: ReturnType<typeof convexTest>, args: Record<string, unknown> = {}) =>
  t.withIdentity(OWNER).query(api.recommendations.list, { ...SLUG, end: DAY, ...args });

describe("who may read it", () => {
  test("NEVER SHIP: staff cannot reach the list, or set anything aside", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await anOrder(t, brownie);
    await expect(
      t.withIdentity(STAFF).query(api.recommendations.list, { ...SLUG, end: DAY }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      t.withIdentity(STAFF).mutation(api.recommendations.dismiss, {
        ...SLUG,
        subjectKey: `item:${brownie}`,
        cents: 100,
        causeKinds: ["waste"],
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("another kitchen's subjects never appear", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await anOrder(t, brownie);
    await expect(
      t
        .withIdentity({ ...OWNER, org_id: "org_b", org_slug: "kitchen-b" })
        .query(api.recommendations.list, { orgSlug: "kitchen-b", end: DAY }),
    ).rejects.toThrow();
  });
});

describe("the empty case is a real outcome", () => {
  test("a healthy kitchen ranks nothing rather than ranking zeroes", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await anOrder(t, brownie);
    const result = await list(t);
    expect(result.live).toHaveLength(0);
    expect(result.stale).toHaveLength(0);
    expect(result.optimiserCapped).toBe(0);
    // But it is not the "you have not set anything up" screen.
    expect(result.hasAnyItem).toBe(true);
  });
});

describe("pricing staleness", () => {
  test("an item that predates priceSetAt stays silent rather than reading as never-priced", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await anOrder(t, brownie);
    // The state every existing item is in: priced, but with no record of when.
    await t.run(async (ctx) => ctx.db.patch(brownie, { priceSetAt: undefined }));
    expect((await list(t)).stale).toHaveLength(0);
  });

  test("a price set 100 days ago is stale; the same price re-saved is not", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await anOrder(t, brownie);
    await t.run(async (ctx) =>
      ctx.db.patch(brownie, { priceSetAt: Date.now() - 100 * MS_DAY }),
    );
    const stale = (await list(t)).stale;
    expect(stale).toHaveLength(1);
    expect(stale[0].name).toBe("Brownies");
    expect(stale[0].days).toBe(100);
  });

  test("ACCEPTANCE: saving a recipe without touching the price does not reset the clock", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await anOrder(t, brownie);
    const long_ago = Date.now() - 100 * MS_DAY;
    await t.run(async (ctx) => ctx.db.patch(brownie, { priceSetAt: long_ago }));

    // Exactly the trap costedAt fell into: a save that changes the batch time
    // must not look like a price decision.
    await t.withIdentity(OWNER).mutation(api.menuItems.save, {
      ...SLUG,
      menuItemId: brownie,
      name: "Brownies",
      notSoldDirectly: false,
      baseBatchYield: 12,
      unitWeightMilligrams: 85_000,
      batchProductionMinutes: 75,
      perUnitExtras: [{ label: "Box", costCents: 20 }],
      priceCents: 300,
      shelfLifeHours: 72,
      lines: [
        {
          componentType: "ingredient" as const,
          componentId: flour,
          qtyMilli: 500_000,
          unit: "g" as const,
        },
      ],
    });
    expect(await t.run(async (ctx) => (await ctx.db.get(brownie))!.priceSetAt)).toBe(
      long_ago,
    );

    // Moving the price DOES reset it, and the item stops being stale.
    await t.withIdentity(OWNER).mutation(api.menuItems.save, {
      ...SLUG,
      menuItemId: brownie,
      name: "Brownies",
      notSoldDirectly: false,
      baseBatchYield: 12,
      unitWeightMilligrams: 85_000,
      batchProductionMinutes: 75,
      perUnitExtras: [{ label: "Box", costCents: 20 }],
      priceCents: 320,
      shelfLifeHours: 72,
      lines: [
        {
          componentType: "ingredient" as const,
          componentId: flour,
          qtyMilli: 500_000,
          unit: "g" as const,
        },
      ],
    });
    expect(await t.run(async (ctx) => (await ctx.db.get(brownie))!.priceSetAt)).toBe(
      Date.now(),
    );
    expect((await list(t)).stale).toHaveLength(0);
  });
});

describe("dormancy, from a scan rather than an index", () => {
  test("no orders for 60 days, with orders before that, and the figure is what it earned", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    // 70 days ago: inside the prior window, outside the recent one.
    await anOrder(t, brownie, { deliveryDate: shift(DAY, -70), units: 10 });

    const dormant = (await list(t)).live.find((r) =>
      r.causes.some((c) => c.kind === "dormant"),
    );
    expect(dormant).toBeDefined();
    expect(dormant!.horizon).toBe("structural");
    // 10 × $3.00. Observed, not projected.
    expect(dormant!.cents).toBe(3_000);
    expect(dormant!.window).toBe("No orders in 70 days");
  });

  test("an item ordered last week is not dormant", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await anOrder(t, brownie, { deliveryDate: shift(DAY, -70) });
    await anOrder(t, brownie, { deliveryDate: shift(DAY, -3) });
    expect(
      (await list(t)).live.some((r) => r.causes.some((c) => c.kind === "dormant")),
    ).toBe(false);
  });

  test("an item never ordered at all is not dormant — it is untried", async () => {
    const t = await kitchen();
    await menu(t);
    expect(
      (await list(t)).live.some((r) => r.causes.some((c) => c.kind === "dormant")),
    ).toBe(false);
  });
});

describe("the batch-size observation", () => {
  test("a base batch of 12 against typical orders of 2 rides along with the waste", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    for (const days of [-1, -2, -3]) {
      await anOrder(t, brownie, { deliveryDate: shift(DAY, days), units: 2 });
    }
    // Bake a batch and sell none of it: the waste is what makes the batch
    // shape worth mentioning at all.
    await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
      batchCount: 1,
      actualYieldMilli: 12_000,
      wasteQtyMilli: 12_000,
      orderIds: [],
    });

    const row = (await list(t)).live.find((r) => r.subjectKey === `item:${brownie}`)!;
    const batch = row.causes.find((c) => c.kind === "batchSize");
    expect(batch).toBeDefined();
    expect(batch!.sentence).toBe("A batch makes 12; a typical order is 2.");
    // Rule 4: the observation adds no money of its own — the waste already
    // counted those dollars, and counting them twice would inflate the bar.
    expect(batch!.cents).toBe(0);
    expect(row.cents).toBe(
      row.causes.find((c) => c.kind === "waste")!.cents,
    );
  });

  test("two orders are not a typical", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    for (const days of [-1, -2]) {
      await anOrder(t, brownie, { deliveryDate: shift(DAY, days), units: 2 });
    }
    await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
      batchCount: 1,
      actualYieldMilli: 12_000,
      wasteQtyMilli: 12_000,
      orderIds: [],
    });
    const row = (await list(t)).live.find((r) => r.subjectKey === `item:${brownie}`)!;
    expect(row.causes.some((c) => c.kind === "batchSize")).toBe(false);
  });
});

describe("the optimiser, run on the server for the first time", () => {
  test("an item below its own target says what would close the gap", async () => {
    const t = await kitchen();
    // Gross is 90% at $3.00; a 92% target is two points out of reach.
    const { brownie } = await menu(t, { targetGrossMarginPercent: 92 });
    await anOrder(t, brownie, { units: 10 });

    const row = (await list(t)).live.find((r) => r.subjectKey === `item:${brownie}`)!;
    const cause = row.causes.find((c) => c.kind === "underpriced")!;
    expect(cause.workings).toContain("would reach 92%");
    expect(row.action.kind).toBe("optimise");
    expect(row.window).toBe("At this period's volume");
    // A per-unit gap turned into money by the period's actual volume.
    expect(row.cents).toBeGreaterThan(0);
  });

  test("an item she has not sold this period costs her nothing this period", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t, { targetGrossMarginPercent: 92 });
    // Delivered long before the window asked about. The price is still wrong,
    // but the wrong price cost her nothing in a month she did not sell it —
    // and a figure invented for it would not be a figure.
    await anOrder(t, brownie, { deliveryDate: shift(DAY, -70) });
    const august = await list(t, { start: "2026-08-01" });
    expect(
      august.live.some((r) => r.causes.some((c) => c.kind === "underpriced")),
    ).toBe(false);
    // Widen the window to one that contains the sale, and it appears.
    const allTime = await list(t);
    expect(
      allTime.live.some((r) => r.causes.some((c) => c.kind === "underpriced")),
    ).toBe(true);
  });

  test("an item already at target produces nothing", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t, { targetGrossMarginPercent: 50 });
    await anOrder(t, brownie);
    expect(
      (await list(t)).live.some((r) => r.causes.some((c) => c.kind === "underpriced")),
    ).toBe(false);
  });
});

describe("setting one aside", () => {
  async function wasteful() {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await anOrder(t, brownie);
    await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
      batchCount: 1,
      actualYieldMilli: 12_000,
      wasteQtyMilli: 12_000,
      orderIds: [],
    });
    return { t, subjectKey: `item:${brownie}`, brownie };
  }

  test("it leaves the ranking, is kept so she can pick it up, and comes back on restore", async () => {
    const { t, subjectKey } = await wasteful();
    const before = (await list(t)).live.find((r) => r.subjectKey === subjectKey)!;

    await t.withIdentity(OWNER).mutation(api.recommendations.dismiss, {
      ...SLUG,
      subjectKey,
      cents: before.cents,
      causeKinds: before.causes.map((c) => c.kind),
    });
    const after = await list(t);
    expect(after.live.some((r) => r.subjectKey === subjectKey)).toBe(false);
    expect(after.dismissed.map((r) => r.subjectKey)).toContain(subjectKey);

    await t
      .withIdentity(OWNER)
      .mutation(api.recommendations.restore, { ...SLUG, subjectKey });
    expect((await list(t)).live.some((r) => r.subjectKey === subjectKey)).toBe(true);
  });

  test("ACCEPTANCE: it comes back when the underlying condition materially changes", async () => {
    const { t, subjectKey, brownie } = await wasteful();
    const before = (await list(t)).live.find((r) => r.subjectKey === subjectKey)!;
    await t.withIdentity(OWNER).mutation(api.recommendations.dismiss, {
      ...SLUG,
      subjectKey,
      cents: before.cents,
      causeKinds: before.causes.map((c) => c.kind),
    });
    expect((await list(t)).live.some((r) => r.subjectKey === subjectKey)).toBe(false);

    // Three more wasted batches: the same problem, three times the size.
    for (let i = 0; i < 3; i += 1) {
      await t.withIdentity(OWNER).mutation(api.production.log, {
        ...SLUG,
        menuItemId: brownie,
        day: DAY,
        batchCount: 1,
        actualYieldMilli: 12_000,
        wasteQtyMilli: 12_000,
        orderIds: [],
      });
    }
    const back = (await list(t)).live.find((r) => r.subjectKey === subjectKey);
    expect(back).toBeDefined();
    expect(back!.cents).toBeGreaterThan(before.cents);
  });

  test("dismissing twice records the newer figure rather than a second row", async () => {
    const { t, subjectKey } = await wasteful();
    for (const cents of [1_000, 2_000]) {
      await t
        .withIdentity(OWNER)
        .mutation(api.recommendations.dismiss, {
          ...SLUG,
          subjectKey,
          cents,
          causeKinds: ["waste"],
        });
    }
    const rows = await t.run(async (ctx) =>
      ctx.db.query("recommendationDismissals").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dismissedAtCents).toBe(2_000);
    expect(rows[0].dismissedBy).toBe("user_owner");
  });
});

describe("the one tap does what the card says", () => {
  test("the drift card's re-cost adopts the median, and the card leaves the list", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await anOrder(t, brownie);
    // Three purchases well above the standard cost: enough for a median, and
    // far enough to clear the 10% threshold.
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i += 1) {
        await ctx.db.insert("purchases", {
          orgId: "org_kitchen_a",
          ingredientId: flour,
          purchaseBatchId: `b${i}`,
          packQtyMilli: 1_000,
          packUnit: "kg" as const,
          qtyBaseMilli: 1_000_000,
          priceCents: 300,
          unitPriceCentsPerThousand: 300,
          purchasedAt: Date.now() - (i + 1) * MS_DAY,
        });
      }
    });
    // Bake, so the period actually consumed flour and the drift has a size.
    await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
      batchCount: 1,
      actualYieldMilli: 12_000,
      wasteQtyMilli: 0,
      orderIds: [],
    });

    const drift = (await list(t)).live.find((r) => r.subjectKey === `ingredient:${flour}`)!;
    expect(drift.action.kind).toBe("adoptMedian");
    expect(drift.action.targetId).toBe(flour);

    await t
      .withIdentity(OWNER)
      .mutation(api.ingredients.adoptMedian, { ...SLUG, ingredientId: flour });
    expect(
      (await list(t)).live.some((r) => r.subjectKey === `ingredient:${flour}`),
    ).toBe(false);
  });
});
