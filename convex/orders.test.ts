import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Order creation acceptance:
 * - a second order from a known customer resolves by phone, no duplicate;
 * - a two-item order saves with correct totals and cost snapshots;
 * - re-pricing the menu afterwards leaves the order's snapshot untouched.
 *
 * The snapshot immutability test is the one that matters most: every figure
 * the dashboard ever reports about last month rests on it.
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
const NEXT_DAY = "2026-08-05";

async function kitchen() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  await t
    .withIdentity({ subject: "user_super" })
    .mutation(api.admin.provisionOrg, {
      orgId: "org_kitchen_a",
      slug: "kitchen-a",
      name: "Kitchen A",
    });
  // $8.00 per production hour, and a flat $5 delivery.
  await t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
    ...SLUG,
    overheadRateCentsPerHour: 800,
    deliveryFeeModel: "flat",
    deliveryFeeConfig: { flatCents: 500 },
  });
  return t;
}

async function ingredient(
  t: ReturnType<typeof convexTest>,
  name: string,
  centsPerThousand: number,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: "org_kitchen_a",
      name,
      baseUnit: "g" as const,
      standardCostCentsPerThousand: centsPerThousand,
      standardCostSetAt: Date.now(),
      trackStock: true,
      alertsMuted: false,
    }),
  );
}

/**
 * The menu from convex/menu.test.ts, whose arithmetic is already proven.
 * Brownie snapshot works out to {15, 20, 71}, cake to {93, 120, 2000}.
 */
async function menu(t: ReturnType<typeof convexTest>) {
  const asOwner = t.withIdentity(OWNER);
  const butter = await ingredient(t, "Butter", 420);
  const flour = await ingredient(t, "Flour", 185);

  const { menuItemId: buttercream } = await asOwner.mutation(api.menuItems.save, {
    ...SLUG,
    name: "Buttercream",
    notSoldDirectly: true,
    baseBatchYield: 10,
    unitWeightMilligrams: 100_000,
    batchProductionMinutes: 20,
    perUnitExtras: [],
    lines: [
      { componentType: "ingredient" as const, componentId: butter, qtyMilli: 1_000_000, unit: "g" as const },
    ],
  });

  const { menuItemId: brownie } = await asOwner.mutation(api.menuItems.save, {
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
      { componentType: "menuItem" as const, componentId: buttercream, qtyMilli: 2_000, unit: "unit" as const },
      { componentType: "ingredient" as const, componentId: flour, qtyMilli: 500_000, unit: "g" as const },
    ],
  });

  const { menuItemId: cake } = await asOwner.mutation(api.menuItems.save, {
    ...SLUG,
    name: "Celebration cake",
    notSoldDirectly: false,
    baseBatchYield: 1,
    unitWeightMilligrams: 2_000_000,
    batchProductionMinutes: 150,
    perUnitExtras: [{ label: "Box", costCents: 120 }],
    priceCents: 3200,
    shelfLifeHours: 96,
    lines: [
      { componentType: "ingredient" as const, componentId: flour, qtyMilli: 500_000, unit: "g" as const },
    ],
  });

  return {
    butter,
    brownie: brownie as Id<"menuItems">,
    cake: cake as Id<"menuItems">,
    buttercream: buttercream as Id<"menuItems">,
  };
}

const CUSTOMER = {
  phone: "+263 71 555 0184",
  name: "Tariro Moyo",
};

const baseOrder = {
  ...SLUG,
  ...CUSTOMER,
  orderDate: DAY,
  deliveryDate: NEXT_DAY,
};

/**
 * Date frozen to DAY for the same reason production.test.ts freezes it:
 * sell-down eligibility compares a batch's real `producedAt` against
 * `endOfDayMs(deliveryDate)`, so any fixture with overhang silently starts
 * failing once the wall clock passes UTC midnight. Nothing here has overhang
 * today; freezing keeps it that way tomorrow. Only `Date` is faked, so
 * convex-test's scheduling is untouched.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("creating an order", () => {
  test("ACCEPTANCE: a second order from a known customer resolves by phone", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });

    // Same number typed without spaces, and the name typed in a hurry.
    await asOwner.mutation(api.orders.create, {
      ...SLUG,
      phone: "+263715550184",
      name: "Tariro",
      orderDate: DAY,
      deliveryDate: NEXT_DAY,
      lines: [{ menuItemId: brownie, qtyMilli: 6_000 }],
    });

    const customers = await t.run(async (ctx) =>
      ctx.db.query("customers").collect(),
    );
    expect(customers).toHaveLength(1);
    // The stored spelling wins — a hurried retype must not lose her record.
    expect(customers[0].name).toBe("Tariro Moyo");
    expect(customers[0].phone).toBe("+263715550184");

    const orders = await t.run(async (ctx) => ctx.db.query("orders").collect());
    expect(orders).toHaveLength(2);
    expect(orders[0].customerId).toBe(orders[1].customerId);
  });

  test("ACCEPTANCE: a two-item order saves with correct totals and snapshots", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie, cake } = await menu(t);

    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [
        { menuItemId: brownie, qtyMilli: 12_000 },
        { menuItemId: cake, qtyMilli: 1_000 },
      ],
      discountCents: 200,
      deliveryCostCents: 400,
    });

    // Creating an order issues no document, so it takes no number.
    const orgAfter = await t.run(async (ctx) =>
      (await ctx.db.query("orgs").collect())[0],
    );
    expect(orgAfter.invoiceSequence).toBe(0);

    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    // 12 brownies at 300 = 3600, one cake at 3200 → 6800.
    expect(data.totals.subtotalCents).toBe(6800);
    expect(data.totals.discountCents).toBe(200);
    expect(data.totals.deliveryFeeCents).toBe(500);
    expect(data.totals.totalCents).toBe(7100);
    expect(data.order.status).toBe("confirmed");
    expect(data.order.revision).toBe(0);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("orderLines").collect(),
    );
    const brownieLine = rows.find((r) => r.menuItemId === brownie)!;
    const cakeLine = rows.find((r) => r.menuItemId === cake)!;
    expect(brownieLine.cogsSnapshot).toEqual({
      ingredientsCents: 15,
      perUnitExtrasCents: 20,
      overheadCents: 71,
    });
    expect(cakeLine.cogsSnapshot).toEqual({
      ingredientsCents: 93,
      perUnitExtrasCents: 120,
      overheadCents: 2000,
    });
    expect(brownieLine.uncosted).toBe(false);

    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    expect(order!.feedbackToken).not.toBe(order!.invoiceToken);
    expect(order!.feedbackToken.startsWith("f_")).toBe(true);
  });

  test("ACCEPTANCE: re-pricing the menu afterwards leaves the snapshot untouched", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie, butter } = await menu(t);

    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });

    const before = await t.run(async (ctx) => {
      const line = (await ctx.db.query("orderLines").collect())[0];
      return JSON.stringify(line.cogsSnapshot);
    });

    // She raises the price AND her butter gets dearer.
    await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      menuItemId: brownie,
      name: "Brownies",
      notSoldDirectly: false,
      baseBatchYield: 12,
      unitWeightMilligrams: 85_000,
      batchProductionMinutes: 60,
      perUnitExtras: [{ label: "Box", costCents: 60 }],
      priceCents: 400,
      shelfLifeHours: 72,
      lines: [],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(butter, { standardCostCentsPerThousand: 840 });
    });

    const after = await t.run(async (ctx) => {
      const line = (await ctx.db.query("orderLines").collect())[0];
      return { snapshot: JSON.stringify(line.cogsSnapshot), price: line.unitPriceCents };
    });

    expect(after.snapshot).toBe(before);
    expect(after.price).toBe(300);
    // And the order still reports what she quoted, not what it costs today.
    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.totals.subtotalCents).toBe(3600);
  });

  test("layer 3 is snapshotted at the real hourly rate, never zero", async () => {
    // The regression guard for loadWorld's deleted rate parameter: a zero
    // here would be permanent and net margin would silently equal gross.
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });
    const rows = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
    expect(rows[0].cogsSnapshot!.overheadCents).toBe(71);

    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.costing!.overheadRateSet).toBe(true);
  });

  test("a kitchen with no hourly rate still saves, and says layer 3 is unset", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG,
      overheadRateCentsPerHour: 0,
    });
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });
    const rows = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
    expect(rows[0].cogsSnapshot!.overheadCents).toBe(0);
    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.costing!.overheadRateSet).toBe(false);
  });

  test("invoice numbers increment on issue, and a cancelled one is never reused", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const line = [{ menuItemId: brownie, qtyMilli: 1_000 }];

    const a = await asOwner.mutation(api.orders.create, { ...baseOrder, lines: line });
    const issuedA = await asOwner.mutation(api.invoices.materialise, {
      ...SLUG, orderId: a.orderId,
    });
    expect(issuedA.number).toBe(1);
    await asOwner.mutation(api.orders.cancel, {
      ...SLUG,
      orderId: a.orderId,
      reason: "She changed her mind.",
    });
    const b = await asOwner.mutation(api.orders.create, { ...baseOrder, lines: line });
    const issuedB = await asOwner.mutation(api.invoices.materialise, {
      ...SLUG, orderId: b.orderId,
    });
    expect(issuedB.number).toBe(2);
    // The cancelled order keeps its number. A void invoice is still a
    // document, and reissuing 1 to someone else is the forgery an auditor
    // is looking for.
    const rows = await t.run(async (ctx) => ctx.db.query("orders").collect());
    expect(rows.find((r) => r._id === a.orderId)!.invoiceNumber).toBe(1);

    const org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect())[0]);
    expect(org.invoiceSequence).toBe(2);
    expect(org.taxLocked).toBe(true);
  });

  test("the tax stamp is frozen: enabling VAT later cannot grow an old invoice", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });

    await asOwner.mutation(api.orgs.updateTax, {
      ...SLUG,
      taxEnabled: true,
      taxRateBp: 1550,
      confirmStamped: true,
    });

    const old = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(old.totals.taxAddedCents).toBe(0);
    expect(old.totals.totalCents).toBe(4100);

    const next = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });
    const fresh = await asOwner.query(api.orders.get, { ...SLUG, orderId: next.orderId });
    // 3600 goods × 15.5% = 558.
    expect(fresh.totals.taxAddedCents).toBe(558);
  });

  test("the delivery fee is decided by the server, not sent by the client", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie, cake } = await menu(t);
    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG,
      deliveryFeeModel: "freeAbove",
      deliveryFeeConfig: { freeAboveCents: 5000, flatCents: 500 },
    });

    const big = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: cake, qtyMilli: 2_000 }],
    });
    const small = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 3_000 }],
    });

    const bigOrder = await t.run(async (ctx) => ctx.db.get(big.orderId));
    const smallOrder = await t.run(async (ctx) => ctx.db.get(small.orderId));
    expect(bigOrder!.deliveryFeeCents).toBe(0);
    expect(smallOrder!.deliveryFeeCents).toBe(500);
  });

  test("perKm charges for the distance, and km is only stored under that model", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG,
      deliveryFeeModel: "perKm",
      deliveryFeeConfig: { perKmCents: 80 },
    });
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 1_000 }],
      deliveryKmMilli: 7_500,
    });
    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    expect(order!.deliveryFeeCents).toBe(600);
    expect(order!.deliveryKmMilli).toBe(7_500);

    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG,
      deliveryFeeModel: "flat",
      deliveryFeeConfig: { flatCents: 500 },
    });
    const flat = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 1_000 }],
      deliveryKmMilli: 7_500,
    });
    const flatOrder = await t.run(async (ctx) => ctx.db.get(flat.orderId));
    expect(flatOrder!.deliveryKmMilli).toBeUndefined();
  });

  test("a discount bigger than the order is clamped at save, not just at render", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 1_000 }],
      discountCents: 99_999,
    });
    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    // Stored clamped, so the column never holds a number that lies.
    expect(order!.discountCents).toBe(300);
    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.totals.totalCents).toBe(500);
  });

  test("an off-menu line saves uncosted and is kept out of the margin", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [
        { menuItemId: brownie, qtyMilli: 12_000 },
        { description: "Custom cupcake tower", qtyMilli: 1_000, unitPriceCents: 4500, roughCostCents: 1800 },
      ],
    });
    const rows = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
    const off = rows.find((r) => !r.menuItemId)!;
    expect(off.uncosted).toBe(true);
    expect(off.cogsSnapshot).toBeUndefined();
    expect(off.roughCostCents).toBe(1800);

    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.costing!.uncostedGoodsCents).toBe(4500);
    expect(data.costing!.costedGoodsCents).toBe(3600);
  });

  test("inclusive tax is taken out of the margin, not counted as hers", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    await asOwner.mutation(api.orgs.updateTax, {
      ...SLUG,
      taxEnabled: true,
      taxRateBp: 1550,
      taxInclusive: true,
    });
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });
    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    // 3600 goods contains 483c of tax; margin is measured on 3117.
    expect(data.totals.taxIncludedCents).toBe(483);
    const layer12 = (15 + 20) * 12; // 420
    expect(data.costing!.grossMarginPercent).toBe(
      Math.round(((3117 - layer12) * 100) / 3117),
    );
  });

  test("charging $5 and burning $4 reads as $1", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
      deliveryCostCents: 400,
    });
    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    const c = data.costing!;
    // Goods 3600 + fee 500 − layers (420 + 852) − fuel 400.
    expect(c.leavesYouCents).toBe(3600 + 500 - 420 - 852 - 400);
    expect(c.deliveryCostMissing).toBe(false);
  });

  test("a fee charged with no cost recorded is flagged to the owner", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 1_000 }],
    });
    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.costing!.deliveryCostMissing).toBe(true);
  });
});

describe("what she cannot save", () => {
  test("an order with no lines", async () => {
    const t = await kitchen();
    await expect(
      t.withIdentity(OWNER).mutation(api.orders.create, { ...baseOrder, lines: [] }),
    ).rejects.toThrow(/at least one item/);
  });

  test("a sub-recipe as a line, named as a sub-recipe rather than as priceless", async () => {
    const t = await kitchen();
    const { buttercream } = await menu(t);
    await expect(
      t.withIdentity(OWNER).mutation(api.orders.create, {
        ...baseOrder,
        lines: [{ menuItemId: buttercream, qtyMilli: 1_000 }],
      }),
    ).rejects.toThrow(/sub-recipe/);
  });

  test("an item deleted between opening the form and saving", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(brownie);
    });
    await expect(
      t.withIdentity(OWNER).mutation(api.orders.create, {
        ...baseOrder,
        lines: [{ menuItemId: brownie, qtyMilli: 1_000 }],
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  test("a zero or negative quantity", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    for (const qtyMilli of [0, -1_000]) {
      await expect(
        t.withIdentity(OWNER).mutation(api.orders.create, {
          ...baseOrder,
          lines: [{ menuItemId: brownie, qtyMilli }],
        }),
      ).rejects.toThrow(/quantity/);
    }
  });

  test("an off-menu line with no price — but zero is a legal price", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    await menu(t);
    await expect(
      asOwner.mutation(api.orders.create, {
        ...baseOrder,
        lines: [{ description: "Tasting sample", qtyMilli: 1_000 }],
      }),
    ).rejects.toThrow(/needs a price/);

    const ok = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ description: "Tasting sample", qtyMilli: 1_000, unitPriceCents: 0 }],
    });
    expect(ok.orderId).toBeDefined();
  });

  test("a delivery date before the order date — but the past is allowed", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const lines = [{ menuItemId: brownie, qtyMilli: 1_000 }];
    await expect(
      asOwner.mutation(api.orders.create, {
        ...baseOrder,
        deliveryDate: "2026-08-03",
        lines,
      }),
    ).rejects.toThrow(/before the order/);

    // Back-entering last week's sale must work.
    const past = await asOwner.mutation(api.orders.create, {
      ...SLUG,
      ...CUSTOMER,
      orderDate: "2026-07-20",
      deliveryDate: "2026-07-21",
      lines,
    });
    expect(past.orderId).toBeDefined();
  });

  test("a kitchen that was never set up", async () => {
    const t = convexTest(schema);
    await expect(
      t.withIdentity(OWNER).mutation(api.orders.create, {
        ...baseOrder,
        lines: [{ description: "Anything", qtyMilli: 1_000, unitPriceCents: 100 }],
      }),
    ).rejects.toThrow();
  });
});

describe("staff and owner", () => {
  test("staff can take an order, and it still snapshots costs", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    const { orderId } = await t.withIdentity(STAFF).mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });
    const rows = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
    // Written for her, not shown to them.
    expect(rows[0].cogsSnapshot).toEqual({
      ingredientsCents: 15,
      perUnitExtrasCents: 20,
      overheadCents: 71,
    });
    expect(orderId).toBeDefined();
  });

  test("ACCEPTANCE: the staff payload carries no costs at all", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
      deliveryCostCents: 400,
    });

    const staff = await t.withIdentity(STAFF).query(api.orders.get, { ...SLUG, orderId });
    expect(staff.costing).toBeNull();
    // Asserted against the serialised payload, which survives refactors that
    // a type-level check would not.
    const serialised = JSON.stringify(staff);
    for (const leak of [
      "cogsSnapshot",
      "deliveryCostCents",
      "roughCostCents",
      "grossMarginPercent",
      "leavesYouCents",
    ]) {
      expect(serialised).not.toContain(leak);
    }
    // …and the owner gets all of it.
    const owner = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(owner.costing!.grossMarginPercent).toBeTypeOf("number");
    expect(owner.costing!.deliveryCostCents).toBe(400);
  });

  test("staff still get the letterhead — they render invoices too", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG,
      paymentInstructions: "EcoCash 0771 234 567",
    });
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 1_000 }],
    });
    const staff = await t.withIdentity(STAFF).query(api.orders.get, { ...SLUG, orderId });
    expect(staff.invoiceOrg.paymentInstructions).toBe("EcoCash 0771 234 567");
    expect(staff.order.invoicePrefix).toBe("INV");
  });

  test("staff sending a cost field is refused, not quietly ignored", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    const asStaff = t.withIdentity(STAFF);
    await expect(
      asStaff.mutation(api.orders.create, {
        ...baseOrder,
        lines: [{ menuItemId: brownie, qtyMilli: 1_000 }],
        deliveryCostCents: 240,
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      asStaff.mutation(api.orders.create, {
        ...baseOrder,
        lines: [{ description: "Thing", qtyMilli: 1_000, unitPriceCents: 100, roughCostCents: 50 }],
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("the delivery-cost pre-fill is owner-only and self-calibrating", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    // Nothing to draw on yet.
    expect(
      await asOwner.query(api.orders.deliveryCostPrefill, { ...SLUG }),
    ).toEqual({ cents: null, source: null });

    await asOwner.mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 1_000 }],
      deliveryCostCents: 375,
    });
    const after = await asOwner.query(api.orders.deliveryCostPrefill, { ...SLUG });
    expect(after.cents).toBe(375);

    await expect(
      t.withIdentity(STAFF).query(api.orders.deliveryCostPrefill, { ...SLUG }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("another kitchen's order is NOT_FOUND, never FORBIDDEN", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 1_000 }],
    });
    await t.withIdentity({ subject: "user_super" }).mutation(api.admin.provisionOrg, {
      orgId: "org_kitchen_b",
      slug: "kitchen-b",
      name: "Kitchen B",
    });
    await expect(
      t
        .withIdentity({
          subject: "user_b",
          org_id: "org_kitchen_b",
          org_slug: "kitchen-b",
          org_role: "org:admin",
        })
        .query(api.orders.get, { orgSlug: "kitchen-b", orderId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});

describe("cancelling", () => {
  async function anOrder(t: ReturnType<typeof convexTest>) {
    const { brownie } = await menu(t);
    return await t.withIdentity(OWNER).mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });
  }

  test("a reason is required, server-side", async () => {
    const t = await kitchen();
    const { orderId } = await anOrder(t);
    const asOwner = t.withIdentity(OWNER);
    for (const reason of ["", "   "]) {
      await expect(
        asOwner.mutation(api.orders.cancel, { ...SLUG, orderId, reason }),
      ).rejects.toThrow(/why it was cancelled/);
    }
    await asOwner.mutation(api.orders.cancel, {
      ...SLUG,
      orderId,
      reason: "  Customer's event was called off.  ",
    });
    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    expect(order!.status).toBe("cancelled");
    expect(order!.cancellationReason).toBe("Customer's event was called off.");
  });

  test("an already-cancelled order keeps its original reason", async () => {
    const t = await kitchen();
    const { orderId } = await anOrder(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.orders.cancel, { ...SLUG, orderId, reason: "First reason." });
    await expect(
      asOwner.mutation(api.orders.cancel, { ...SLUG, orderId, reason: "Second reason." }),
    ).rejects.toThrow(/already cancelled/);
    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    expect(order!.cancellationReason).toBe("First reason.");
  });

  test("a delivered order cannot be cancelled", async () => {
    const t = await kitchen();
    const { orderId } = await anOrder(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(orderId, { status: "delivered" });
    });
    await expect(
      t.withIdentity(OWNER).mutation(api.orders.cancel, {
        ...SLUG,
        orderId,
        reason: "Mistake.",
      }),
    ).rejects.toThrow(/was delivered/);
  });

  test("cancelling keeps the lines and their snapshots — history is not deleted", async () => {
    const t = await kitchen();
    const { orderId } = await anOrder(t);
    const before = await t.run(async (ctx) =>
      JSON.stringify(await ctx.db.query("orderLines").collect()),
    );
    await t.withIdentity(OWNER).mutation(api.orders.cancel, {
      ...SLUG,
      orderId,
      reason: "Called off.",
    });
    const after = await t.run(async (ctx) =>
      JSON.stringify(await ctx.db.query("orderLines").collect()),
    );
    expect(after).toBe(before);
  });

  test("production already logged stays on the books as waste", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
      ...baseOrder,
      lines: [{ menuItemId: brownie, qtyMilli: 12_000 }],
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("productionLogs", {
        orgId: "org_kitchen_a",
        menuItemId: brownie,
        orderIds: [orderId],
        batchCount: 2,
        expectedYieldMilli: 24_000,
        actualYieldMilli: 24_000,
        producedAt: Date.now(),
        producedOn: DAY,
        cogsSnapshot: {
          ingredientsCents: 15,
          perUnitExtrasCents: 20,
          overheadCents: 71,
        },
        overhangQtyMilli: 0,
        overhangRemainingQtyMilli: 0,
        wasteQtyMilli: 0,
      });
    });
    const logsBefore = await t.run(async (ctx) =>
      JSON.stringify(await ctx.db.query("productionLogs").collect()),
    );

    const result = await t.withIdentity(OWNER).mutation(api.orders.cancel, {
      ...SLUG,
      orderId,
      reason: "Customer cancelled after I'd baked.",
    });
    expect(result).toEqual({
      productionLogged: true,
      batchCount: 2,
      // Nothing was served off the shelf, so nothing goes back on it.
      overhangReturnedMilli: 0,
    });

    // Untouched — that is HOW the cost stays on the books as waste.
    const logsAfter = await t.run(async (ctx) =>
      JSON.stringify(await ctx.db.query("productionLogs").collect()),
    );
    expect(logsAfter).toBe(logsBefore);
  });
});
