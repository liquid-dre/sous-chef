import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Her final say, end to end.
 *
 * The arithmetic is proved in convex/lib/portion-evidence.test.ts. What is
 * proved here is that the evidence reaching the panel is real — traced through
 * actual production logs rather than assembled by hand — and that overriding
 * silences exactly one size and no other.
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
  vi.unstubAllEnvs();
});
afterEach(() => vi.useRealTimers());

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
  });
  return t;
}

async function menu(t: ReturnType<typeof convexTest>, baseBatchYield = 12) {
  const flour = await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: "org_kitchen_a",
      name: "Flour",
      baseUnit: "g" as const,
      standardCostCentsPerThousand: 185,
      standardCostSetAt: Date.now(),
      trackStock: false,
      alertsMuted: false,
    }),
  );
  const { menuItemId } = await t.withIdentity(OWNER).mutation(api.menuItems.save, {
    ...SLUG,
    name: "Brownies",
    notSoldDirectly: false,
    baseBatchYield,
    unitWeightMilligrams: 85_000,
    batchProductionMinutes: 60,
    perUnitExtras: [{ label: "Box", costCents: 20 }],
    priceCents: 300,
    targetGrossMarginPercent: 70,
    shelfLifeHours: 72,
    sensoryAxes: ["portionSize", "sweetness"],
    lines: [
      {
        componentType: "ingredient" as const,
        componentId: flour,
        qtyMilli: 500_000,
        unit: "g" as const,
      },
    ],
  });
  return menuItemId as Id<"menuItems">;
}

/** An order, a batch logged against it at `yieldUnits`, and a portion rating. */
async function servedAt(
  t: ReturnType<typeof convexTest>,
  brownie: Id<"menuItems">,
  yieldUnits: number,
  portionValue: number,
  phone: string,
) {
  const asOwner = t.withIdentity(OWNER);
  // The yield in effect at bake time is what gets frozen onto the log.
  await t.run(async (ctx) => ctx.db.patch(brownie, { baseBatchYield: yieldUnits }));

  const { orderId } = await asOwner.mutation(api.orders.create, {
    ...SLUG,
    phone,
    name: "Tariro Moyo",
    orderDate: DAY,
    deliveryDate: DAY,
    lines: [{ menuItemId: brownie, qtyMilli: 2_000 }],
  });
  await asOwner.mutation(api.production.log, {
    ...SLUG,
    menuItemId: brownie,
    batchCount: 1,
    actualYieldMilli: yieldUnits * 1000,
    orderIds: [orderId as Id<"orders">],
    day: DAY,
  });
  await asOwner.mutation(api.feedback.log, {
    ...SLUG,
    orderId: orderId as Id<"orders">,
    menuItemId: brownie,
    axisRatings: [{ axis: "portionSize", value: portionValue }],
  });
  return orderId as Id<"orders">;
}

const builder = (t: ReturnType<typeof convexTest>, menuItemId: Id<"menuItems">) =>
  t.withIdentity(OWNER).query(api.menuItems.getForBuilder, { ...SLUG, menuItemId });

describe("the evidence reaching the panel", () => {
  test("ACCEPTANCE: with no feedback there is nothing, not an empty shape", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const data = await builder(t, brownie);
    // The 1.3 optimiser, untouched.
    expect(data.portionEvidence).toEqual({
      byYield: [],
      untraceable: 0,
      complainedYields: [],
      total: 0,
    });
    expect(data.overrideReport).toBeNull();
    expect(data.overriddenYields).toEqual([]);
  });

  test("ACCEPTANCE: ratings attach to the size the tray was cut at", async () => {
    const t = await kitchen();
    const brownie = await menu(t);

    // Three served at 15, two of whom called it small.
    await servedAt(t, brownie, 15, -2, "+263715550001");
    await servedAt(t, brownie, 15, -1, "+263715550002");
    await servedAt(t, brownie, 15, 0, "+263715550003");
    // Two at 12, neither complaining.
    await servedAt(t, brownie, 12, 0, "+263715550004");
    await servedAt(t, brownie, 12, 1, "+263715550005");

    const { portionEvidence } = await builder(t, brownie);
    expect(portionEvidence!.byYield).toEqual([
      {
        yieldUnits: 12,
        saidTooSmall: 0,
        n: 2,
        sentence: "2 ratings, and nobody called it small.",
      },
      {
        yieldUnits: 15,
        saidTooSmall: 2,
        n: 3,
        sentence: "2 of 3 said it was too small.",
      },
    ]);
    expect(portionEvidence!.complainedYields).toEqual([15]);
    expect(portionEvidence!.untraceable).toBe(0);
  });

  test("a rating on an order no batch claimed is untraceable, not assumed", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const asOwner = t.withIdentity(OWNER);

    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...SLUG,
      phone: "+263715550010",
      name: "Tariro Moyo",
      orderDate: DAY,
      deliveryDate: DAY,
      lines: [{ menuItemId: brownie, qtyMilli: 2_000 }],
    });
    // Baked without ticking the order — a legal, ordinary thing to do.
    await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [], day: DAY,
    });
    await asOwner.mutation(api.feedback.log, {
      ...SLUG,
      orderId: orderId as Id<"orders">,
      menuItemId: brownie,
      axisRatings: [{ axis: "portionSize", value: -2 }],
    });

    const { portionEvidence } = await builder(t, brownie);
    // Never attributed to today's yield, which is the assumption that would
    // make the whole claim a lie.
    expect(portionEvidence!.byYield).toEqual([]);
    expect(portionEvidence!.untraceable).toBe(1);
    expect(portionEvidence!.total).toBe(1);
  });
});

describe("proceeding anyway", () => {
  test("NEVER SHIP: staff cannot record or undo an override", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    for (const call of [
      t.withIdentity(STAFF).mutation(api.optimiserOverrides.record, {
        ...SLUG, menuItemId: brownie, yieldUnits: 12,
      }),
      t.withIdentity(STAFF).mutation(api.optimiserOverrides.undo, {
        ...SLUG, menuItemId: brownie, yieldUnits: 12,
      }),
    ]) {
      await expect(call).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    }
  });

  test("another kitchen sees none of it", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await expect(
      t
        .withIdentity({ ...OWNER, org_id: "org_b", org_slug: "kitchen-b" })
        .mutation(api.optimiserOverrides.record, {
          orgSlug: "kitchen-b", menuItemId: brownie, yieldUnits: 12,
        }),
    ).rejects.toThrow();
  });

  test("ACCEPTANCE: it stamps what she was actually shown", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await servedAt(t, brownie, 15, -2, "+263715550001");
    await servedAt(t, brownie, 15, -1, "+263715550002");
    await servedAt(t, brownie, 15, 0, "+263715550003");

    await t.withIdentity(OWNER).mutation(api.optimiserOverrides.record, {
      ...SLUG, menuItemId: brownie, yieldUnits: 15,
    });

    const [row] = await t.run(async (ctx) =>
      ctx.db.query("optimiserOverrides").collect(),
    );
    // Frozen, not recomputed later — the report has to compare against the
    // figures that were on screen when she decided.
    expect(row.saidTooSmallAtDecision).toBe(2);
    expect(row.sampleAtDecision).toBe(3);
    expect(row.yieldUnits).toBe(15);
    expect(row.decidedBy).toBe("user_owner");
    expect(row.grossMarginPercentAtDecision).toBeTypeOf("number");
  });

  test("ACCEPTANCE: it silences that size and no other", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await servedAt(t, brownie, 15, -2, "+263715550001");
    await servedAt(t, brownie, 12, -2, "+263715550002");

    await t.withIdentity(OWNER).mutation(api.optimiserOverrides.record, {
      ...SLUG, menuItemId: brownie, yieldUnits: 15,
    });

    const data = await builder(t, brownie);
    expect(data.overriddenYields).toEqual([15]);
    // 12 drew a complaint too, and that decision has not been made.
    expect(data.portionEvidence!.complainedYields).toEqual([12, 15]);
  });

  test("ACCEPTANCE: changing the yield brings the decision back into play", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await servedAt(t, brownie, 15, -2, "+263715550001");
    await t.withIdentity(OWNER).mutation(api.optimiserOverrides.record, {
      ...SLUG, menuItemId: brownie, yieldUnits: 15,
    });
    // The report is built for the size she is ON.
    expect((await builder(t, brownie)).overrideReport).not.toBeNull();

    // She moves the tray. A different cut is a different decision.
    await t.run(async (ctx) => ctx.db.patch(brownie, { baseBatchYield: 18 }));
    const after = await builder(t, brownie);
    expect(after.overrideReport).toBeNull();
    expect(after.overriddenYields).toEqual([15]);
  });

  test("deciding twice about one size does not reset the before figures", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await servedAt(t, brownie, 15, -2, "+263715550001");
    const first = await t.withIdentity(OWNER).mutation(api.optimiserOverrides.record, {
      ...SLUG, menuItemId: brownie, yieldUnits: 15,
    });

    // More complaints arrive, then the button is tapped again.
    await servedAt(t, brownie, 15, -2, "+263715550002");
    const second = await t.withIdentity(OWNER).mutation(api.optimiserOverrides.record, {
      ...SLUG, menuItemId: brownie, yieldUnits: 15,
    });

    expect(second.overrideId).toBe(first.overrideId);
    const rows = await t.run(async (ctx) =>
      ctx.db.query("optimiserOverrides").collect(),
    );
    expect(rows).toHaveLength(1);
    // Still 1 of 1 — otherwise the report would compare the present to itself.
    expect(rows[0].saidTooSmallAtDecision).toBe(1);
    expect(rows[0].sampleAtDecision).toBe(1);
  });

  test("undo puts the warning back and takes the report away", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await servedAt(t, brownie, 15, -2, "+263715550001");
    await t.withIdentity(OWNER).mutation(api.optimiserOverrides.record, {
      ...SLUG, menuItemId: brownie, yieldUnits: 15,
    });
    await t.withIdentity(OWNER).mutation(api.optimiserOverrides.undo, {
      ...SLUG, menuItemId: brownie, yieldUnits: 15,
    });

    const data = await builder(t, brownie);
    expect(data.overriddenYields).toEqual([]);
    expect(data.overrideReport).toBeNull();
  });

  test("the report splits at the decision and names no cause", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await servedAt(t, brownie, 15, -1, "+263715550001");
    await t.withIdentity(OWNER).mutation(api.optimiserOverrides.record, {
      ...SLUG, menuItemId: brownie, yieldUnits: 15,
    });

    // A day passes and two more people speak.
    vi.setSystemTime(new Date("2026-08-05T09:00:00Z"));
    await servedAt(t, brownie, 15, -2, "+263715550002");
    await servedAt(t, brownie, 15, -2, "+263715550003");

    const { overrideReport } = await builder(t, brownie);
    expect(overrideReport!.before).toMatchObject({ saidTooSmall: 1, n: 1 });
    expect(overrideReport!.since).toMatchObject({ saidTooSmall: 2, n: 2 });
    expect(overrideReport!.sentences[0]).toBe(
      "2 of 2 have said it was too small since, against 1 of 1 before.",
    );
    // No volume figure reaches the client at all.
    expect(JSON.stringify(overrideReport).toLowerCase()).not.toContain("sold");
  });
});
