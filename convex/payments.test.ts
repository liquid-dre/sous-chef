import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Payments acceptance:
 * - two $40 payments against an $80 order produce Paid, with no state field
 *   written anywhere — and removing one walks it back, which is the only
 *   assertion that actually distinguishes derived from stored;
 * - a quick sale writes order + payment + cost snapshot in one go;
 * - overpayment is allowed and surfaced, never blocked.
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

/** The proven menu from orders.test.ts: brownie snapshot {15,20,71}. */
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
  const { menuItemId: taster } = await asOwner.mutation(api.menuItems.save, {
    ...SLUG,
    name: "Taster",
    notSoldDirectly: false,
    baseBatchYield: 1,
    unitWeightMilligrams: 10_000,
    batchProductionMinutes: 0,
    perUnitExtras: [],
    priceCents: 0,
    shelfLifeHours: 24,
    lines: [],
  });
  return {
    brownie: brownie as Id<"menuItems">,
    buttercream: buttercream as Id<"menuItems">,
    taster: taster as Id<"menuItems">,
  };
}

/**
 * Exactly $80.00: a $75 off-menu line plus the flat $5 delivery fee. Stated
 * as a helper so the number in the test name is the number in the assertion.
 */
async function anEightyDollarOrder(
  t: ReturnType<typeof convexTest>,
  over: {
    phone?: string;
    name?: string;
    orderDate?: string;
    deliveryDate?: string;
  } = {},
) {
  const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
    ...SLUG,
    phone: over.phone ?? "+263715550184",
    name: over.name ?? "Tariro Moyo",
    // Defaults to the delivery day, so a back-dated delivery is legal.
    orderDate: over.orderDate ?? over.deliveryDate ?? DAY,
    deliveryDate: over.deliveryDate ?? DAY,
    lines: [{ description: "Custom cake", qtyMilli: 1_000, unitPriceCents: 7500 }],
  });
  return orderId;
}

beforeEach(() => vi.unstubAllEnvs());

describe("payments as a table", () => {
  test("ACCEPTANCE: two $40 payments produce Paid, with no state field written", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anEightyDollarOrder(t);

    const before = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(before.totals.totalCents).toBe(8000);
    expect(before.payments.status).toBe("unpaid");

    const first = await asOwner.mutation(api.payments.record, {
      ...SLUG,
      orderId,
      amountCents: 4000,
    });
    expect(first).toMatchObject({
      paidCents: 4000,
      balanceCents: 4000,
      excessCents: 0,
      status: "partPaid",
    });

    const second = await asOwner.mutation(api.payments.record, {
      ...SLUG,
      orderId,
      amountCents: 4000,
    });
    expect(second).toMatchObject({
      paidCents: 8000,
      balanceCents: 0,
      excessCents: 0,
      status: "paid",
    });

    // --- nothing about payment was written to the order ---
    const doc = await t.run(async (ctx) => ctx.db.get(orderId));
    for (const key of Object.keys(doc!)) {
      expect(key).not.toMatch(/paid|payment|balance|owing|settled/i);
    }
    // status exists, but it is FULFILMENT and payment never touched it.
    expect(doc!.status).toBe("confirmed");
    expect(JSON.stringify(doc)).not.toMatch(/partPaid|unpaid/);

    // --- and the proof it is computed: it walks backwards on its own ---
    const rows = await t.run(async (ctx) => ctx.db.query("payments").collect());
    await asOwner.mutation(api.payments.remove, {
      ...SLUG,
      paymentId: rows[1]._id,
    });
    const after = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(after.payments.status).toBe("partPaid");
    expect(after.payments.paidCents).toBe(4000);
    expect(after.payments.balanceCents).toBe(4000);
    // A stored status could not have done that without something patching it.
    const stillNoField = await t.run(async (ctx) => ctx.db.get(orderId));
    expect(stillNoField!.status).toBe("confirmed");
  });

  test("ACCEPTANCE: overpayment is allowed and surfaced", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anEightyDollarOrder(t);

    const result = await asOwner.mutation(api.payments.record, {
      ...SLUG,
      orderId,
      amountCents: 9000,
    });
    expect(result).toMatchObject({
      paidCents: 9000,
      // Zero, NOT −1000.
      balanceCents: 0,
      excessCents: 1000,
      status: "paid",
    });

    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.payments.excessCents).toBe(1000);
    // No fourth status anywhere in the payload.
    expect(JSON.stringify(data)).not.toMatch(/overpaid|overPaid|credit/i);

    // The aggregate guard: an overpayment must not cancel someone else's
    // debt. A second, untouched $80 order still reads as $80 owed.
    await anEightyDollarOrder(t, { phone: "+263772119003", name: "Rudo" });
    const list = await asOwner.query(api.orders.list, {
      ...SLUG,
      filter: "owing",
      today: DAY,
    });
    expect(list.owedCents).toBe(8000);
    expect(list.owingCount).toBe(1);
  });

  test("a whole number of cents is required, and zero or negative is refused", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anEightyDollarOrder(t);
    await expect(
      asOwner.mutation(api.payments.record, { ...SLUG, orderId, amountCents: 4000.5 }),
    ).rejects.toThrow(/whole number of cents/);
    for (const amountCents of [0, -4000]) {
      await expect(
        asOwner.mutation(api.payments.record, { ...SLUG, orderId, amountCents }),
      ).rejects.toThrow(/needs an amount/);
    }
  });

  test("a cancelled order takes no new payment, but keeps the ones it had", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anEightyDollarOrder(t);
    await asOwner.mutation(api.payments.record, { ...SLUG, orderId, amountCents: 4000 });
    await asOwner.mutation(api.orders.cancel, {
      ...SLUG,
      orderId,
      reason: "Her event was called off.",
    });

    await expect(
      asOwner.mutation(api.payments.record, { ...SLUG, orderId, amountCents: 1000 }),
    ).rejects.toThrow(/was cancelled/);

    // The deposit she already took is money she genuinely holds. Erasing it
    // would make the ledger disagree with her bank.
    const rows = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(4000);
  });

  test("paidAt defaults to now, accepts back-dating, and refuses the future", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anEightyDollarOrder(t);

    await asOwner.mutation(api.payments.record, { ...SLUG, orderId, amountCents: 100 });
    const lastWeek = Date.now() - 7 * 86_400_000;
    await asOwner.mutation(api.payments.record, {
      ...SLUG,
      orderId,
      amountCents: 100,
      paidAt: lastWeek,
    });
    const rows = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(rows.some((r) => Math.abs(r.paidAt - Date.now()) < 5000)).toBe(true);
    // Back-dating is preserved verbatim — she must be able to catch up.
    expect(rows.some((r) => r.paidAt === lastWeek)).toBe(true);

    await expect(
      asOwner.mutation(api.payments.record, {
        ...SLUG,
        orderId,
        amountCents: 100,
        paidAt: Date.now() + 3 * 86_400_000,
      }),
    ).rejects.toThrow(/in the future/);
  });

  test("who took the money is recorded", async () => {
    const t = await kitchen();
    const orderId = await anEightyDollarOrder(t);
    await t
      .withIdentity(STAFF)
      .mutation(api.payments.record, { ...SLUG, orderId, amountCents: 100 });
    const rows = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(rows[0].recordedBy).toBe("user_staff");
  });
});

describe("undoing a payment", () => {
  test("the owner may remove any payment, however old", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anEightyDollarOrder(t);
    const { paymentId } = await asOwner.mutation(api.payments.record, {
      ...SLUG,
      orderId,
      amountCents: 4000,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(paymentId, { paidAt: Date.now() - 14 * 86_400_000 });
    });
    const after = await asOwner.mutation(api.payments.remove, { ...SLUG, paymentId });
    expect(after.status).toBe("unpaid");
  });

  test("staff may undo their own tap, and nobody else's", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const asStaff = t.withIdentity(STAFF);
    const orderId = await anEightyDollarOrder(t);

    const mine = await asStaff.mutation(api.payments.record, {
      ...SLUG,
      orderId,
      amountCents: 1000,
    });
    const hers = await asOwner.mutation(api.payments.record, {
      ...SLUG,
      orderId,
      amountCents: 1000,
    });

    await expect(
      asStaff.mutation(api.payments.remove, { ...SLUG, paymentId: hers.paymentId }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

    // Their own, inside the window, is fine.
    await asStaff.mutation(api.payments.remove, { ...SLUG, paymentId: mine.paymentId });
    const rows = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(rows).toHaveLength(1);
  });

  test("removing another kitchen's payment is NOT_FOUND, never FORBIDDEN", async () => {
    const t = await kitchen();
    const orderId = await anEightyDollarOrder(t);
    const { paymentId } = await t
      .withIdentity(OWNER)
      .mutation(api.payments.record, { ...SLUG, orderId, amountCents: 100 });
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
        .mutation(api.payments.remove, { orgSlug: "kitchen-b", paymentId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  test("removing the same payment twice is NOT_FOUND, not a silent success", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anEightyDollarOrder(t);
    const { paymentId } = await asOwner.mutation(api.payments.record, {
      ...SLUG,
      orderId,
      amountCents: 100,
    });
    await asOwner.mutation(api.payments.remove, { ...SLUG, paymentId });
    await expect(
      asOwner.mutation(api.payments.remove, { ...SLUG, paymentId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});

describe("the two-tap counter sale", () => {
  test("ACCEPTANCE: a quick sale writes order, payment and snapshot in one go", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    const result = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
    });
    expect(result).toMatchObject({
      itemName: "Brownies",
      qtyMilli: 1000,
      totalCents: 300,
    });

    const order = await t.run(async (ctx) => ctx.db.get(result.orderId));
    expect(order!.customerId).toBeUndefined();
    expect(order!.source).toBe("quickSale");
    expect(order!.status).toBe("delivered");
    expect(order!.deliveryFeeCents).toBe(0);
    expect(order!.discountCents).toBe(0);
    expect(order!.orderDate).toBe(DAY);
    expect(order!.deliveryDate).toBe(DAY);

    const lines = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
    expect(lines).toHaveLength(1);
    expect(lines[0].unitPriceCents).toBe(300);
    expect(lines[0].uncosted).toBe(false);
    // Byte-identical to what orders.create writes for the same item.
    expect(lines[0].cogsSnapshot).toEqual({
      ingredientsCents: 15,
      perUnitExtrasCents: 20,
      overheadCents: 71,
    });

    const rows = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(300);

    // No sentinel person was invented.
    const customers = await t.run(async (ctx) => ctx.db.query("customers").collect());
    expect(customers).toHaveLength(0);

    const data = await asOwner.query(api.orders.get, {
      ...SLUG,
      orderId: result.orderId,
    });
    expect(data.payments.status).toBe("paid");
    expect(data.payments.balanceCents).toBe(0);
    expect(data.customer).toBeNull();
  });

  test("the flat delivery fee does NOT apply to a walk-in", async () => {
    // With a $5 flat model configured, running the fee helper would charge a
    // walk-in for a delivery that never happened — and the payment would
    // match it, so the order would look correctly settled at the wrong total.
    const t = await kitchen();
    const { brownie } = await menu(t);
    const result = await t
      .withIdentity(OWNER)
      .mutation(api.orders.quickSale, { ...SLUG, menuItemId: brownie, day: DAY });
    expect(result.totalCents).toBe(300);
    const rows = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(rows[0].amountCents).toBe(300);
  });

  test("a free item records the sale with no payment row, and reads as paid", async () => {
    // The regression for the status ladder: testing paid <= 0 first would
    // read this as unpaid forever.
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { taster } = await menu(t);
    const result = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: taster,
      day: DAY,
    });
    expect(result.paymentId).toBeNull();
    expect(result.totalCents).toBe(0);
    const data = await asOwner.query(api.orders.get, {
      ...SLUG,
      orderId: result.orderId,
    });
    expect(data.payments.status).toBe("paid");
    expect(data.payments.balanceCents).toBe(0);

    // And it must not appear in the chase list.
    const list = await asOwner.query(api.orders.list, {
      ...SLUG,
      filter: "owing",
      today: DAY,
    });
    expect(list.rows).toHaveLength(0);
    expect(list.owedCents).toBe(0);
  });

  test("a sub-recipe and a priceless item are refused, with the right message each", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { buttercream } = await menu(t);
    await expect(
      asOwner.mutation(api.orders.quickSale, { ...SLUG, menuItemId: buttercream, day: DAY }),
    ).rejects.toThrow(/sub-recipe/);

    const { menuItemId: priceless } = await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      name: "Unpriced thing",
      notSoldDirectly: false,
      baseBatchYield: 1,
      unitWeightMilligrams: 1000,
      batchProductionMinutes: 0,
      perUnitExtras: [],
      shelfLifeHours: 24,
      lines: [],
    });
    await expect(
      asOwner.mutation(api.orders.quickSale, {
        ...SLUG,
        menuItemId: priceless as Id<"menuItems">,
        day: DAY,
      }),
    ).rejects.toThrow(/has no price yet/);
  });

  test("layer 3 is snapshotted at the real rate, and staff may sell", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await t
      .withIdentity(STAFF)
      .mutation(api.orders.quickSale, { ...SLUG, menuItemId: brownie, day: DAY });
    const lines = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
    // Written for her, not shown to them.
    expect(lines[0].cogsSnapshot!.overheadCents).toBe(71);
  });

  test("ACCEPTANCE: a quick sale burns no invoice number", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    await anEightyDollarOrder(t);
    // Three counter sales and two deliberate orders, none of them issued.
    for (let i = 0; i < 3; i++) {
      await asOwner.mutation(api.orders.quickSale, {
        ...SLUG, menuItemId: brownie, day: DAY,
      });
    }
    await anEightyDollarOrder(t, { phone: "+263772119003", name: "Rudo" });
    let org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect())[0]);
    expect(org.invoiceSequence).toBe(0);

    // The first document she actually issues is INV-0001, not INV-0006.
    const last = await anEightyDollarOrder(t, {
      phone: "+263772119004", name: "Tanaka",
    });
    const issued = await asOwner.mutation(api.invoices.materialise, {
      ...SLUG, orderId: last,
    });
    expect(issued.label).toBe("INV-0001");
    org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect())[0]);
    expect(org.invoiceSequence).toBe(1);
  });

  test("inclusive tax leaves the payment at the shelf price", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    await asOwner.mutation(api.orgs.updateTax, {
      ...SLUG,
      taxEnabled: true,
      taxRateBp: 1550,
      taxInclusive: true,
    });
    const result = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
    });
    // The price IS the total under an inclusive model; paying
    // subtotal − taxIncluded would be an easy and invisible mistake.
    expect(result.totalCents).toBe(300);
    const rows = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(rows[0].amountCents).toBe(300);
  });

  test("×2 is absolute, so tapping it twice still means two", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
    });
    await asOwner.mutation(api.orders.setQuickSaleQuantity, {
      ...SLUG,
      orderId,
      qtyMilli: 2000,
    });
    const again = await asOwner.mutation(api.orders.setQuickSaleQuantity, {
      ...SLUG,
      orderId,
      qtyMilli: 2000,
    });
    expect(again).toEqual({ qtyMilli: 2000, totalCents: 600 });
    const lines = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
    expect(lines[0].qtyMilli).toBe(2000);
    const rows = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(rows[0].amountCents).toBe(600);
    // Still settled — the invariant "a counter sale is paid in full" holds.
    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.payments.status).toBe("paid");
  });

  test("quantity cannot be changed on a deliberate order", async () => {
    const t = await kitchen();
    const orderId = await anEightyDollarOrder(t);
    await expect(
      t.withIdentity(OWNER).mutation(api.orders.setQuickSaleQuantity, {
        ...SLUG,
        orderId,
        qtyMilli: 2000,
      }),
    ).rejects.toThrow(/isn't a counter sale/);
  });

  test("undo removes the sale entirely, and takes no number with it", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
    });
    await asOwner.mutation(api.orders.undoQuickSale, { ...SLUG, orderId });

    expect(await t.run(async (ctx) => ctx.db.get(orderId))).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("orderLines").collect())).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("payments").collect())).toHaveLength(0);
    // Nothing was ever issued, so the series never moved and there is no
    // hole for the deletion to leave behind.
    const org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect())[0]);
    expect(org.invoiceSequence).toBe(0);
  });

  test("ACCEPTANCE: undo refuses once an invoice has been issued", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
    });
    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });
    // Deleting it now would leave INV-0001 with nothing behind it, which is
    // the gap the whole allocation scheme exists to prevent.
    await expect(
      asOwner.mutation(api.orders.undoQuickSale, { ...SLUG, orderId }),
    ).rejects.toThrow(/invoice was issued/);
    expect(await t.run(async (ctx) => ctx.db.get(orderId))).not.toBeNull();

    // Cancelling is still open, and leaves a void document behind the number.
    await asOwner.mutation(api.orders.cancel, {
      ...SLUG, orderId, reason: "Mis-tapped at the stall.",
    });
    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    expect(order!.status).toBe("cancelled");
    expect(order!.invoiceNumber).toBe(1);
  });

  test("undo refuses a deliberate order and refuses after the window", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const real = await anEightyDollarOrder(t);
    await expect(
      asOwner.mutation(api.orders.undoQuickSale, { ...SLUG, orderId: real }),
    ).rejects.toThrow(/isn't a counter sale/);

    const { orderId } = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
    });
    // Age it past the window. The window binds the owner too: removing a
    // payment is reversible, destroying a sale destroys its cost snapshot.
    await t.run(async (ctx) => {
      const doc = await ctx.db.get(orderId);
      await ctx.db.replace(orderId, { ...doc!, revision: 0 });
    });
    vi.setSystemTime(Date.now() + 20 * 60 * 1000);
    await expect(
      asOwner.mutation(api.orders.undoQuickSale, { ...SLUG, orderId }),
    ).rejects.toThrow(/Too late to undo/);
    vi.useRealTimers();
  });

  test("a mis-tapped sale found tomorrow can still be cancelled, and its payment goes with it", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { orderId } = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: brownie,
      day: DAY,
    });

    await asOwner.mutation(api.orders.cancel, {
      ...SLUG,
      orderId,
      reason: "Mis-tapped at the stall.",
    });
    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    expect(order!.status).toBe("cancelled");
    expect(order!.cancellationReason).toBe("Mis-tapped at the stall.");
    // The payment was written by the same tap, so it goes with the sale.
    expect(await t.run(async (ctx) => ctx.db.query("payments").collect())).toHaveLength(0);
    // Never issued, so there was never a number to preserve.
    expect(order!.invoiceNumber).toBeUndefined();
  });

  test("a real delivered order still cannot be cancelled", async () => {
    const t = await kitchen();
    const orderId = await anEightyDollarOrder(t);
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

  test("the chips carry prices, exclude sub-recipes, and distinguish the empty states", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const bare = await asOwner.query(api.orders.quickSaleItems, { ...SLUG });
    expect(bare).toEqual({ items: [], hasMenuItems: false });

    await menu(t);
    const full = await asOwner.query(api.orders.quickSaleItems, { ...SLUG });
    expect(full.hasMenuItems).toBe(true);
    expect(full.items.map((i) => i.name)).toEqual(["Brownies", "Taster"]);
    expect(full.items.find((i) => i.name === "Brownies")!.priceCents).toBe(300);
  });
});

describe("the orders list", () => {
  test("the three filters are three readings of the same rows", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    const past = await anEightyDollarOrder(t, { deliveryDate: "2026-08-01" });
    const future = await anEightyDollarOrder(t, {
      phone: "+263772119003",
      name: "Rudo",
      deliveryDate: "2026-09-01",
    });
    const paid = await anEightyDollarOrder(t, {
      phone: "+263783440021",
      name: "Tanaka",
      deliveryDate: DAY,
    });
    await asOwner.mutation(api.payments.record, { ...SLUG, orderId: paid, amountCents: 8000 });
    const cancelled = await anEightyDollarOrder(t, {
      phone: "+263771000000",
      name: "Chipo",
      deliveryDate: DAY,
    });
    await asOwner.mutation(api.orders.cancel, { ...SLUG, orderId: cancelled, reason: "Called off." });
    await asOwner.mutation(api.orders.quickSale, { ...SLUG, menuItemId: brownie, day: DAY });

    const upcoming = await asOwner.query(api.orders.list, { ...SLUG, filter: "upcoming", today: DAY });
    // Today counts as upcoming: an order due today is still to be baked. The
    // fully-paid one is on it too — paid in advance is still to be made.
    expect(upcoming.rows.map((r) => r.id)).toEqual([paid, future]);
    // The quick sale is absent despite its delivery date being today,
    // because it is already delivered. Requiring `confirmed` is what keeps
    // counter sales off the bake list.
    expect(upcoming.rows.some((r) => r.source === "quickSale")).toBe(false);
    // The cancelled one is absent too.
    expect(upcoming.rows.some((r) => r.id === cancelled)).toBe(false);

    const owing = await asOwner.query(api.orders.list, { ...SLUG, filter: "owing", today: DAY });
    expect(owing.rows.map((r) => r.id)).toEqual([past]);
    expect(owing.owedCents).toBe(8000);

    const all = await asOwner.query(api.orders.list, { ...SLUG, filter: "all", today: DAY });
    expect(all.rows).toHaveLength(5);
  });

  test("owing is sorted by how long the money has been late, not by order date", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    // A: ordered long ago, delivered later. B: ordered recently, delivered
    // first. Sorting by orderDate would give the opposite answer.
    const a = await t.withIdentity(OWNER).mutation(api.orders.create, {
      ...SLUG,
      phone: "+263715550184",
      name: "Tariro",
      orderDate: "2026-01-02",
      deliveryDate: "2026-07-01",
      lines: [{ description: "Wedding cake", qtyMilli: 1_000, unitPriceCents: 7500 }],
    });
    const b = await t.withIdentity(OWNER).mutation(api.orders.create, {
      ...SLUG,
      phone: "+263772119003",
      name: "Rudo",
      orderDate: "2026-06-01",
      deliveryDate: "2026-06-01",
      lines: [{ description: "Birthday cake", qtyMilli: 1_000, unitPriceCents: 7500 }],
    });

    const owing = await asOwner.query(api.orders.list, {
      ...SLUG,
      filter: "owing",
      today: "2026-08-04",
    });
    expect(owing.rows.map((r) => r.id)).toEqual([b.orderId, a.orderId]);
    expect(owing.rows[0].ageDays).toBe(64);
    expect(owing.rows[1].ageDays).toBe(34);
  });

  test("a walk-in row says so without inventing a customer", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    await asOwner.mutation(api.orders.quickSale, { ...SLUG, menuItemId: brownie, day: DAY });
    const all = await asOwner.query(api.orders.list, { ...SLUG, filter: "all", today: DAY });
    expect(all.rows[0]).toMatchObject({
      customerName: "Walk-in",
      customerId: null,
      isWalkIn: true,
      paymentStatus: "paid",
      status: "delivered",
    });
    expect(await t.run(async (ctx) => ctx.db.query("customers").collect())).toHaveLength(0);
  });

  test("the deposit button reads the order's stamp, not the live org default", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.orgs.updateProfile, { ...SLUG, defaultDepositPercent: 50 });
    const orderId = await anEightyDollarOrder(t);

    const before = await asOwner.query(api.orders.list, { ...SLUG, filter: "owing", today: DAY });
    expect(before.rows[0]).toMatchObject({ depositShown: true, depositCents: 4000 });

    // She changes the default in June; March's order must not move.
    await asOwner.mutation(api.orgs.updateProfile, { ...SLUG, defaultDepositPercent: 30 });
    const after = await asOwner.query(api.orders.list, { ...SLUG, filter: "owing", today: DAY });
    expect(after.rows[0].depositCents).toBe(4000);

    // Once anything is paid, the deposit tap is gone.
    await asOwner.mutation(api.payments.record, { ...SLUG, orderId, amountCents: 100 });
    const paid = await asOwner.query(api.orders.list, { ...SLUG, filter: "owing", today: DAY });
    expect(paid.rows[0].depositShown).toBe(false);
    expect(paid.rows[0].depositCents).toBe(0);
  });

  test("another kitchen sees none of it", async () => {
    const t = await kitchen();
    await anEightyDollarOrder(t);
    await t.withIdentity({ subject: "user_super" }).mutation(api.admin.provisionOrg, {
      orgId: "org_kitchen_b",
      slug: "kitchen-b",
      name: "Kitchen B",
    });
    const other = await t
      .withIdentity({
        subject: "user_b",
        org_id: "org_kitchen_b",
        org_slug: "kitchen-b",
        org_role: "org:admin",
      })
      .query(api.orders.list, { orgSlug: "kitchen-b", filter: "all", today: DAY });
    expect(other.rows).toHaveLength(0);
    expect(other.owedCents).toBe(0);
  });

  test("the list does not fan out into one query per order", async () => {
    // Twelve orders. Without the Maps this would be dozens of reads and
    // nothing would fail — it would just get slower every month.
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    for (let i = 0; i < 12; i += 1) {
      await anEightyDollarOrder(t, {
        phone: `+26377100000${i}`,
        name: `Customer ${i}`,
      });
    }
    const list = await asOwner.query(api.orders.list, { ...SLUG, filter: "all", today: DAY });
    expect(list.rows).toHaveLength(12);
    expect(list.owedCents).toBe(12 * 8000);
  });

  test("the page is capped but the debt total is not", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    for (let i = 0; i < 4; i += 1) {
      await anEightyDollarOrder(t, { phone: `+26377200000${i}`, name: `C${i}` });
    }
    const list = await asOwner.query(api.orders.list, {
      ...SLUG,
      filter: "owing",
      today: DAY,
      limit: 2,
    });
    expect(list.rows).toHaveLength(2);
    expect(list.hasMore).toBe(true);
    // The aggregate is over everything, so the Owing tab can show its total
    // while she is standing on another filter.
    expect(list.owedCents).toBe(4 * 8000);
    expect(list.owingCount).toBe(4);
  });
});
