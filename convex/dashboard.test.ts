import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Home, end to end. The arithmetic is proved in convex/lib/pnl.test.ts; what
 * is proved here is that the right ROWS reach it — the right window, the right
 * kitchen, and nobody who shouldn't see any of it.
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
  // Same reason as production.test.ts: sell-down and overhang expiry compare a
  // real Date.now() against domain days, so a real clock makes these tests
  // depend on when they are run.
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
    targetNetMarginPercent: 35,
  });
  return t;
}

async function menu(t: ReturnType<typeof convexTest>) {
  const asOwner = t.withIdentity(OWNER);
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
  const { menuItemId } = await asOwner.mutation(api.menuItems.save, {
    ...SLUG,
    name: "Brownies",
    notSoldDirectly: false,
    baseBatchYield: 12,
    unitWeightMilligrams: 85_000,
    batchProductionMinutes: 60,
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
  return { brownie: menuItemId as Id<"menuItems">, flour };
}

/**
 * The fixture's arithmetic, stated once so every expectation below is
 * traceable rather than magic:
 *   ingredients  500g of flour a batch at 185c/1000g = 92.5c, over 12 = 8c
 *   packaging    the box, 20c
 *   overhead     800c/hr x 1hr, over 12 = 67c
 *   ------------------------------------------------ 95c the unit
 * The org runs a flat $5 delivery fee, so a ten-unit order is
 * $30 of goods + $5 of delivery = $35 in, $9.50 out.
 */
const UNIT_COST_CENTS = 95;
const FLAT_DELIVERY_CENTS = 500;

async function anOrder(
  t: ReturnType<typeof convexTest>,
  brownie: Id<"menuItems">,
  over: { deliveryDate?: string; phone?: string; name?: string; units?: number } = {},
) {
  const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
    ...SLUG,
    phone: over.phone ?? "+263715550184",
    name: over.name ?? "Tariro Moyo",
    orderDate: over.deliveryDate ?? DAY,
    deliveryDate: over.deliveryDate ?? DAY,
    lines: [{ menuItemId: brownie, qtyMilli: (over.units ?? 10) * 1000 }],
  });
  return orderId;
}

describe("who may read it", () => {
  test("NEVER SHIP: staff cannot reach the claim or the breakdown", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await anOrder(t, brownie);
    for (const fn of [api.dashboard.claim, api.dashboard.breakdown]) {
      await expect(
        t.withIdentity(STAFF).query(fn, { ...SLUG, end: DAY }),
      ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    }
  });

  test("another kitchen sees none of it", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await anOrder(t, brownie);
    await expect(
      t
        .withIdentity({ ...OWNER, org_id: "org_b", org_slug: "kitchen-b" })
        .query(api.dashboard.claim, { orgSlug: "kitchen-b", end: DAY }),
    ).rejects.toThrow();
  });
});

describe("the window", () => {
  test("revenue recognises on the DELIVERY date, not the order date", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    // Ordered inside the window, delivered after it.
    await asOwner.mutation(api.orders.create, {
      ...SLUG,
      phone: "+263715550184",
      name: "Tariro Moyo",
      orderDate: "2026-08-01",
      deliveryDate: "2026-09-10",
      lines: [{ menuItemId: brownie, qtyMilli: 10_000 }],
    });
    const august = await asOwner.query(api.dashboard.claim, {
      ...SLUG, start: "2026-08-01", end: "2026-08-31",
    });
    expect(august.pnl.grossRevenueCents).toBe(0);
    expect(august.hasAnyOrder).toBe(false);

    const september = await asOwner.query(api.dashboard.claim, {
      ...SLUG, start: "2026-09-01", end: "2026-09-30",
    });
    expect(september.pnl.grossRevenueCents).toBe(3_000 + FLAT_DELIVERY_CENTS);
  });

  test("a cancelled order earns nothing", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const orderId = await anOrder(t, brownie);
    await asOwner.mutation(api.orders.cancel, {
      ...SLUG, orderId, reason: "Called off.",
    });
    const claim = await asOwner.query(api.dashboard.claim, { ...SLUG, end: DAY });
    expect(claim.pnl.grossRevenueCents).toBe(0);
  });

  test("the previous period is the same LENGTH, ending the day before", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    // One order in the previous week, none in this one.
    await anOrder(t, brownie, { deliveryDate: "2026-07-28" });

    const thisWeek = await asOwner.query(api.dashboard.claim, {
      ...SLUG, start: "2026-08-03", end: "2026-08-09",
    });
    expect(thisWeek.pnl.netMarginPercent).toBeNull();
    // The comparison window is Jul 27 – Aug 2: seven days ending the day
    // before. Comparing a part-week against a whole month is how a dashboard
    // tells someone they collapsed when they are two days in.
    // (3500 - 950) / 3500 = 72.85… → 73
    expect(thisWeek.comparison.previousPeriodMarginPercent).toBe(73);
  });
});

describe("ACCEPTANCE: period basis, through real production logs", () => {
  test("a batch baked for July's order, expiring in August, is an August loss", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    // Baked on 30 July with a 72-hour shelf life: it goes off on 2 August.
    vi.setSystemTime(new Date("2026-07-30T09:00:00Z"));
    await asOwner.mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 1,
      actualYieldMilli: 12_000,
      orderIds: [],
      day: "2026-07-30",
    });
    vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));

    const july = await asOwner.query(api.dashboard.claim, {
      ...SLUG, start: "2026-07-01", end: "2026-07-31",
    });
    // Still good on 31 July, so July carries none of it.
    expect(july.pnl.wasteCents).toBe(0);

    const august = await asOwner.query(api.dashboard.claim, {
      ...SLUG, start: "2026-08-01", end: "2026-08-31",
    });
    // 12 units at 95c, recognised when it stopped being sellable — which is
    // the whole reason this screen is period-basis.
    expect(august.pnl.wasteCents).toBe(12 * UNIT_COST_CENTS);
    expect(august.leaks[0].kind).toBe("waste");
    expect(august.leaks[0].sentence).toContain("Brownies");
  });

  test("the breakdown says how much of the loss belongs to no order", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    await anOrder(t, brownie);
    await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [], day: DAY, wasteQtyMilli: 3_000, wasteReason: "Dropped the tray.",
    });

    const claim = await asOwner.query(api.dashboard.claim, { ...SLUG, end: DAY });
    const breakdown = await asOwner.query(api.dashboard.breakdown, { ...SLUG, end: DAY });
    const perOrder = breakdown.orders.reduce((a, o) => a + o.profitCents, 0);
    // Stated, not hidden: this is the number that explains why the list below
    // does not add up to the sentence above.
    expect(breakdown.unattributedWasteCents).toBe(claim.pnl.wasteCents);
    expect(perOrder - claim.pnl.profitCents).toBe(breakdown.unattributedWasteCents);
  });
});

describe("the shapes she will have", () => {
  test("zero orders: a claim with nothing in it, and no invented leak", async () => {
    const t = await kitchen();
    const claim = await t
      .withIdentity(OWNER)
      .query(api.dashboard.claim, { ...SLUG, end: DAY });
    expect(claim.hasAnyOrder).toBe(false);
    expect(claim.pnl.netMarginPercent).toBeNull();
    expect(claim.leaks).toEqual([]);

    const breakdown = await t
      .withIdentity(OWNER)
      .query(api.dashboard.breakdown, { ...SLUG, end: DAY });
    expect(breakdown.items).toEqual([]);
    expect(breakdown.sankey.links).toEqual([]);
  });

  test("three orders: every figure resolves and the item ranking works", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    for (let i = 0; i < 3; i++) {
      await anOrder(t, brownie, { phone: `+26377211900${i}`, name: `Customer ${i}` });
    }
    const claim = await asOwner.query(api.dashboard.claim, { ...SLUG, end: DAY });
    expect(claim.pnl.orderCount).toBe(3);
    expect(claim.pnl.netMarginPercent).toBe(73);

    const breakdown = await asOwner.query(api.dashboard.breakdown, { ...SLUG, end: DAY });
    expect(breakdown.items).toHaveLength(1);
    expect(breakdown.items[0].name).toBe("Brownies");
    // 60 minutes a batch, 12 to a batch, 30 units sold = 150 minutes.
    expect(breakdown.items[0].productionMinutes).toBe(150);
    expect(breakdown.customers).toHaveLength(3);
  });

  test("uncosted revenue reaches the claim as its own figure", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    await asOwner.mutation(api.orders.create, {
      ...SLUG,
      phone: "+263715550184",
      name: "Tariro Moyo",
      orderDate: DAY,
      deliveryDate: DAY,
      lines: [
        { menuItemId: brownie, qtyMilli: 10_000 },
        { description: "Catering, off menu", qtyMilli: 1_000, unitPriceCents: 7_000 },
      ],
    });
    const claim = await asOwner.query(api.dashboard.claim, { ...SLUG, end: DAY });
    expect(claim.pnl.uncostedRevenueCents).toBe(7_000);
    expect(claim.pnl.grossRevenueCents).toBe(3_000 + FLAT_DELIVERY_CENTS);
    // 7000 of 10500 total revenue.
    expect(claim.pnl.uncostedSharePercent).toBe(67);
    // The margin is the costed work's margin, untouched by the $70.
    expect(claim.pnl.netMarginPercent).toBe(73);
  });
});
