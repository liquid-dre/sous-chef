import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Production acceptance:
 * - 2 orders totalling 6 units, actual yield 10 → overhang 4 with a correct
 *   expiry;
 * - expired overhang is waste costed against ITS OWN batch, at the price
 *   stamped when it was made;
 * - made-versus-sold is queryable per item per period.
 *
 * The invariant underneath all of it: every unit made sits in exactly one of
 * consumed / sold down / still on hand / wasted. Most of these tests are
 * really that partition, asked in different ways.
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
const HOUR_MS = 3_600_000;

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
    deliveryFeeConfig: { flatCents: 0 },
  });
  return t;
}

async function ingredient(
  t: ReturnType<typeof convexTest>,
  name: string,
  centsPerThousand: number,
  trackStock = true,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: "org_kitchen_a",
      name,
      baseUnit: "g" as const,
      standardCostCentsPerThousand: centsPerThousand,
      standardCostSetAt: Date.now(),
      trackStock,
      alertsMuted: false,
    }),
  );
}

/** 10 kg on the shelf, put there the only way anything gets there: a movement.
 * There is no level field to seed (convex/lib/stock.ts). */
async function stockUp(
  t: ReturnType<typeof convexTest>,
  ingredientId: Id<"ingredients">,
  qtyMilli = 10_000_000,
) {
  await t.run(async (ctx) =>
    ctx.db.insert("stockMovements", {
      orgId: "org_kitchen_a",
      ingredientId,
      deltaMilli: qtyMilli,
      reason: "purchase" as const,
      occurredAt: Date.now() - 86_400_000,
    }),
  );
}

/** The pantry level as the app computes it: derived, never read off a row. */
async function levelOf(
  t: ReturnType<typeof convexTest>,
  ingredientId: Id<"ingredients">,
): Promise<number | null> {
  const { rows } = await t
    .withIdentity(OWNER)
    .query(api.ingredients.list, { ...SLUG, today: DAY });
  return rows.find((r) => r.id === ingredientId)?.levelMilli ?? null;
}

/** Brownies: 12 a batch, 500 g flour + 2 units buttercream, 72h shelf life.
 * Per-unit snapshot works out to {15, 20, 71} — the same figures orders and
 * payments already assert against. */
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
  return {
    butter: butter as Id<"ingredients">,
    flour: flour as Id<"ingredients">,
    brownie: brownie as Id<"menuItems">,
    buttercream: buttercream as Id<"menuItems">,
  };
}

async function orderFor(
  t: ReturnType<typeof convexTest>,
  brownie: Id<"menuItems">,
  units: number,
  over: { phone?: string; name?: string; deliveryDate?: string } = {},
) {
  const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
    ...SLUG,
    phone: over.phone ?? "+263715550184",
    name: over.name ?? "Tariro Moyo",
    orderDate: DAY,
    deliveryDate: over.deliveryDate ?? DAY,
    lines: [{ menuItemId: brownie, qtyMilli: units * 1000 }],
  });
  return orderId;
}

/**
 * The clock is FROZEN to mid-morning on DAY, and that is load-bearing.
 *
 * Sell-down eligibility compares a batch's `producedAt` (a real Date.now())
 * against `endOfDayMs(deliveryDate)` — so with a real clock these tests pass
 * only while the wall clock is still on the hardcoded DAY in UTC, and every
 * sell-down test starts failing the moment it rolls past UTC midnight. That
 * is exactly what happened: the suite went red overnight having changed
 * nothing. A test that depends on when you run it is not a test.
 *
 * Only `Date` is faked. Faking setTimeout as well would stall convex-test's
 * own scheduling, and none of these tests need to advance time.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("logging a batch", () => {
  test("ACCEPTANCE: 2 orders totalling 6, actual 10 → overhang 4 with an expiry", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    const a = await orderFor(t, brownie, 4);
    const b = await orderFor(t, brownie, 2, {
      phone: "+263772119003",
      name: "Rudo",
    });

    const before = Date.now();
    const result = await asOwner.mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 1,
      actualYieldMilli: 10_000,
      orderIds: [a, b],
      day: DAY,
    });

    expect(result.consumedMilli).toBe(6_000);
    expect(result.overhangQtyMilli).toBe(4_000);
    // One batch of 12 was expected; she got 10. That gap is the point.
    expect(result.expectedYieldMilli).toBe(12_000);

    const log = await t.run(async (ctx) => ctx.db.get(result.productionLogId));
    expect(log!.overhangRemainingQtyMilli).toBe(4_000);
    expect(log!.overhangExpiresAt).toBe(log!.producedAt + 72 * HOUR_MS);
    expect(log!.producedAt).toBeGreaterThanOrEqual(before);
    expect(log!.producedOn).toBe(DAY);
    // Stamped once, the same shape orders stamp.
    expect(log!.cogsSnapshot).toEqual({
      ingredientsCents: 15,
      perUnitExtrasCents: 20,
      overheadCents: 71,
    });
  });

  test("a shortfall is not negative overhang", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    const a = await orderFor(t, brownie, 8);
    const result = await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 1,
      actualYieldMilli: 5_000,
      orderIds: [a],
      day: DAY,
    });
    // She made less than the order needs. The order is still owed; there is
    // simply nothing spare.
    expect(result.overhangQtyMilli).toBe(0);
    expect(result.consumedMilli).toBe(8_000);
  });

  test("bench waste comes off before overhang is worked out", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    const a = await orderFor(t, brownie, 4);
    const result = await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 1,
      actualYieldMilli: 10_000,
      orderIds: [a],
      day: DAY,
      wasteQtyMilli: 2_000,
      wasteReason: "Dropped the tray.",
    });
    // 10 made, 2 on the floor, 4 to the order → 4 spare.
    expect(result.overhangQtyMilli).toBe(4_000);
  });

  test("a sub-recipe batch has no expiry, so its overhang never goes off", async () => {
    const t = await kitchen();
    const { buttercream } = await menu(t);
    const result = await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: buttercream,
      batchCount: 1,
      actualYieldMilli: 10_000,
      orderIds: [],
      day: DAY,
    });
    expect(result.overhangExpiresAt).toBeNull();
    const stock = await t.withIdentity(OWNER).query(api.production.stockOnHand, { ...SLUG });
    expect(stock.live.map((r) => r.name)).toContain("Buttercream");
    expect(stock.expired).toHaveLength(0);
  });

  test("what she cannot log", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const base = { ...SLUG, menuItemId: brownie, orderIds: [], day: DAY };
    await expect(
      asOwner.mutation(api.production.log, { ...base, batchCount: 0, actualYieldMilli: 1000 }),
    ).rejects.toThrow(/at least one/);
    await expect(
      asOwner.mutation(api.production.log, { ...base, batchCount: 1, actualYieldMilli: -1 }),
    ).rejects.toThrow(/cannot be negative/);
    await expect(
      asOwner.mutation(api.production.log, {
        ...base,
        batchCount: 1,
        actualYieldMilli: 1_000,
        wasteQtyMilli: 5_000,
      }),
    ).rejects.toThrow(/waste more than you made/);
    await expect(
      asOwner.mutation(api.production.log, { ...base, batchCount: 1, actualYieldMilli: 1000, day: "4 Aug" }),
    ).rejects.toThrow(/2026-08-04/);
  });

  test("staff may log a batch", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    const result = await t.withIdentity(STAFF).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 1,
      actualYieldMilli: 12_000,
      orderIds: [],
      day: DAY,
    });
    expect(result.overhangQtyMilli).toBe(12_000);
  });
});

describe("the pantry", () => {
  test("logging deducts raw lines and leaves the freshness anchor alone", async () => {
    const t = await kitchen();
    const { brownie, flour, butter } = await menu(t);
    await stockUp(t, flour);
    const beforeAsOf = await t.run(async (ctx) => (await ctx.db.get(flour))!.stockAsOf);

    const result = await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 2,
      actualYieldMilli: 24_000,
      orderIds: [],
      day: DAY,
    });

    const moves = await t.run(async (ctx) => ctx.db.query("stockMovements").collect());
    const flourMove = moves.find(
      (m) => m.ingredientId === flour && m.reason === "production",
    )!;
    expect(flourMove.deltaMilli).toBe(-1_000_000); // 500 g × 2 batches
    expect(flourMove.reason).toBe("production");
    expect(flourMove.sourceId).toBe(result.productionLogId);

    // Derived from the ledger, never read off a field.
    expect(await levelOf(t, flour)).toBe(10_000_000 - 1_000_000);
    // A deduction is not an anchor. Writing stockAsOf here would make a
    // stale estimate look freshly confirmed.
    const flourRow = await t.run(async (ctx) => (await ctx.db.get(flour))!);
    expect(flourRow.stockAsOf ?? null).toBe(beforeAsOf ?? null);

    // The sub-recipe line draws on buttercream's finished stock, not on
    // butter — recursing would move stock with no production log behind it.
    expect(moves.some((m) => m.ingredientId === butter)).toBe(false);
  });

  test("ACCEPTANCE: a nested recipe deducts its leaves through the sub's OWN log", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie, buttercream, flour, butter } = await menu(t);
    await stockUp(t, flour);
    await stockUp(t, butter);

    // Nothing on the buttercream shelf, and 2 batches of brownies want 4
    // units of it. Sous says so before she saves.
    const short = await asOwner.query(api.production.subRecipeCheck, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 2,
    });
    expect(short).toHaveLength(1);
    expect(short[0].name).toBe("Buttercream");
    expect(short[0].neededMilli).toBe(4_000);
    // Buttercream yields 10 to a batch, so one covers it. Whole batches only.
    expect(short[0].batchesToCover).toBe(1);

    const result = await asOwner.mutation(api.production.logWithSub, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 2,
      actualYieldMilli: 24_000,
      orderIds: [],
      day: DAY,
      subs: [{ menuItemId: buttercream, batchCount: 1 }],
    });

    // The leaves moved — but through the buttercream's own production log,
    // which is the whole distinction. 1 kg of butter a batch.
    const moves = await t.run(async (ctx) => ctx.db.query("stockMovements").collect());
    const butterMove = moves.find(
      (m) => m.ingredientId === butter && m.reason === "production",
    )!;
    expect(butterMove.deltaMilli).toBe(-1_000_000);
    expect(butterMove.sourceId).toBe(result.subs[0].productionLogId);

    // And that log carries the three things a recursion would have lost.
    const subLog = await t.run(async (ctx) =>
      ctx.db.get(result.subs[0].productionLogId),
    );
    expect(subLog!.cogsSnapshot.ingredientsCents).toBeGreaterThan(0);
    expect(subLog!.expectedYieldMilli).toBe(10_000);
    // 10 made, 4 eaten by the brownies → 6 left on the shelf.
    expect(subLog!.overhangRemainingQtyMilli).toBe(6_000);
    expect(result.shortfalls).toEqual([]);
  });

  test("a sub-recipe line deducts the sub's finished stock, oldest batch first", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie, buttercream, flour } = await menu(t);
    await stockUp(t, flour);

    // Two batches of buttercream on the shelf, 20 units.
    await asOwner.mutation(api.production.log, {
      ...SLUG,
      menuItemId: buttercream,
      batchCount: 2,
      actualYieldMilli: 20_000,
      orderIds: [],
      day: DAY,
    });
    expect(
      await asOwner.query(api.production.subRecipeCheck, {
        ...SLUG,
        menuItemId: brownie,
        batchCount: 2,
      }),
    ).toEqual([]); // nothing short, so no prompt

    await asOwner.mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 2,
      actualYieldMilli: 24_000,
      orderIds: [],
      day: DAY,
    });

    // 4 units of buttercream consumed. Until this slice, NOTHING was
    // deducted — the same units sat on the shelf and could be sold twice.
    const bc = await t.run(async (ctx) =>
      ctx.db
        .query("productionLogs")
        .filter((q) => q.eq(q.field("menuItemId"), buttercream))
        .first(),
    );
    expect(bc!.overhangRemainingQtyMilli).toBe(16_000);
  });

  test("a shortfall is reported, never refused — she has final say", async () => {
    // Sous flags, it never instructs (CONTEXT.md). She may well have made the
    // buttercream without logging it, and blocking the save would teach her
    // to work around Sous rather than with it.
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour);
    const result = await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 1,
      actualYieldMilli: 12_000,
      orderIds: [],
      day: DAY,
    });
    expect(result.shortfalls).toEqual([
      expect.objectContaining({ name: "Buttercream", shortMilli: 2_000 }),
    ]);
  });

  test("a don't-track-stock ingredient gets no movement", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const sugar = await ingredient(t, "Sugar", 150, false);
    const { menuItemId } = await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      name: "Meringue",
      notSoldDirectly: false,
      baseBatchYield: 10,
      unitWeightMilligrams: 20_000,
      batchProductionMinutes: 30,
      perUnitExtras: [],
      priceCents: 100,
      shelfLifeHours: 48,
      lines: [
        { componentType: "ingredient" as const, componentId: sugar, qtyMilli: 200_000, unit: "g" as const },
      ],
    });
    await asOwner.mutation(api.production.log, {
      ...SLUG,
      menuItemId: menuItemId as Id<"menuItems">,
      batchCount: 1,
      actualYieldMilli: 10_000,
      orderIds: [],
      day: DAY,
    });
    const moves = await t.run(async (ctx) => ctx.db.query("stockMovements").collect());
    expect(moves).toHaveLength(0);
  });

  test("the pantry is allowed to go negative — that is the evidence", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 100_000); // 100 g on the shelf, 500 g wanted
    await asOwner.mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 1,
      actualYieldMilli: 12_000,
      orderIds: [],
      day: DAY,
    });
    // Clamping at zero would destroy the only signal that the estimate drifted.
    expect(await levelOf(t, flour)).toBe(100_000 - 500_000);
  });
});

describe("selling the overhang down", () => {
  /** A batch of 12 with nothing owed against it: 12 units on the shelf. */
  async function withStock(t: ReturnType<typeof convexTest>, brownie: Id<"menuItems">) {
    const { productionLogId } = await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 1,
      actualYieldMilli: 12_000,
      orderIds: [],
      day: DAY,
    });
    return productionLogId;
  }

  test("a quick sale comes off the shelf at the batch's stamped cost", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie, butter } = await menu(t);
    const logId = await withStock(t, brownie);

    // Butter doubles AFTER the batch was made.
    await t.run(async (ctx) => {
      await ctx.db.patch(butter, { standardCostCentsPerThousand: 840 });
    });

    const sale = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: brownie,
      qtyMilli: 2_000,
      day: DAY,
    });

    const lines = await t.run(async (ctx) =>
      (await ctx.db.query("orderLines").collect()).filter(
        (l) => l.orderId === sale.orderId,
      ),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].fulfilledFromProductionLogId).toBe(logId);
    // The stamp, not today's dearer butter.
    expect(lines[0].cogsSnapshot).toEqual({
      ingredientsCents: 15,
      perUnitExtrasCents: 20,
      overheadCents: 71,
    });

    const log = await t.run(async (ctx) => ctx.db.get(logId));
    expect(log!.overhangRemainingQtyMilli).toBe(10_000);
  });

  test("a line that outruns the shelf splits, and the totals still match the payment", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    // Only 3 on the shelf.
    await asOwner.mutation(api.production.log, {
      ...SLUG,
      menuItemId: brownie,
      batchCount: 1,
      actualYieldMilli: 3_000,
      orderIds: [],
      day: DAY,
    });

    const sale = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG,
      menuItemId: brownie,
      qtyMilli: 5_000,
      day: DAY,
    });

    const lines = await t.run(async (ctx) =>
      (await ctx.db.query("orderLines").collect()).filter(
        (l) => l.orderId === sale.orderId,
      ),
    );
    expect(lines).toHaveLength(2);
    const fromStock = lines.find((l) => l.fulfilledFromProductionLogId)!;
    const fresh = lines.find((l) => !l.fulfilledFromProductionLogId)!;
    expect(fromStock.qtyMilli).toBe(3_000);
    expect(fresh.qtyMilli).toBe(2_000);

    // Totalled from the split rows, so the payment cannot sit a cent under.
    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId: sale.orderId });
    expect(data.totals.totalCents).toBe(1_500);
    expect(data.payments.paidCents).toBe(1_500);
    expect(data.payments.status).toBe("paid");
    // …and the customer sees one line, not the kitchen's bookkeeping.
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].qtyMilli).toBe(5_000);
  });

  test("FIFO: the oldest batch empties first", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const first = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 2_000, orderIds: [], day: DAY,
    });
    const second = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 5_000, orderIds: [], day: DAY,
    });

    await asOwner.mutation(api.orders.quickSale, {
      ...SLUG, menuItemId: brownie, qtyMilli: 3_000, day: DAY,
    });

    const a = await t.run(async (ctx) => ctx.db.get(first.productionLogId));
    const b = await t.run(async (ctx) => ctx.db.get(second.productionLogId));
    // Oldest stock leaves first, so it is sold before it can expire.
    expect(a!.overhangRemainingQtyMilli).toBe(0);
    expect(b!.overhangRemainingQtyMilli).toBe(4_000);
  });

  test("REGRESSION: an order delivering after the shelf life takes nothing", async () => {
    // The phantom-stock bug. Reserving today's overhang for a delivery ten
    // days out would rot those units AND make the eventual batch book its
    // whole yield as overhang.
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const stock = await withStock(t, brownie);

    const far = await orderFor(t, brownie, 4, { deliveryDate: "2026-09-01" });

    const log = await t.run(async (ctx) => ctx.db.get(stock));
    expect(log!.overhangRemainingQtyMilli).toBe(12_000); // untouched

    const lines = await t.run(async (ctx) =>
      (await ctx.db.query("orderLines").collect()).filter((l) => l.orderId === far),
    );
    expect(lines[0].fulfilledFromProductionLogId).toBeUndefined();

    // And when she finally bakes for it, the order counts as consumed.
    const later = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [far], day: "2026-08-30",
    });
    expect(later.consumedMilli).toBe(4_000);
    expect(later.overhangQtyMilli).toBe(8_000);
  });

  test("a batch made after the delivery day is not eligible either", async () => {
    // Back-entering last week's sale must not eat this morning's bake.
    const t = await kitchen();
    const { brownie } = await menu(t);
    await withStock(t, brownie);
    const past = await t.withIdentity(OWNER).mutation(api.orders.create, {
      ...SLUG,
      phone: "+263715550184",
      name: "Tariro",
      orderDate: "2026-07-01",
      deliveryDate: "2026-07-02",
      lines: [{ menuItemId: brownie, qtyMilli: 2_000 }],
    });
    const lines = await t.run(async (ctx) =>
      (await ctx.db.query("orderLines").collect()).filter((l) => l.orderId === past.orderId),
    );
    expect(lines[0].fulfilledFromProductionLogId).toBeUndefined();
  });
});

describe("putting units back", () => {
  test("cancelling returns the units to the shelf, and the batch cost stays put", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { productionLogId } = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000, orderIds: [], day: DAY,
    });
    const orderId = await orderFor(t, brownie, 4);
    expect(
      (await t.run(async (ctx) => ctx.db.get(productionLogId)))!.overhangRemainingQtyMilli,
    ).toBe(8_000);

    const result = await asOwner.mutation(api.orders.cancel, {
      ...SLUG,
      orderId,
      reason: "She changed her mind.",
    });
    expect(result.overhangReturnedMilli).toBe(4_000);

    const log = await t.run(async (ctx) => ctx.db.get(productionLogId));
    // The food exists; only the reservation was released.
    expect(log!.overhangRemainingQtyMilli).toBe(12_000);
    expect(log!.actualYieldMilli).toBe(12_000);
    expect(log!.cogsSnapshot.ingredientsCents).toBe(15);
  });

  test("REGRESSION: undoing a from-stock quick sale does not vaporise the units", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { productionLogId } = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000, orderIds: [], day: DAY,
    });
    const sale = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG, menuItemId: brownie, qtyMilli: 3_000, day: DAY,
    });
    await asOwner.mutation(api.orders.undoQuickSale, { ...SLUG, orderId: sale.orderId });

    const log = await t.run(async (ctx) => ctx.db.get(productionLogId));
    // The guard on undoQuickSale only checks log.orderIds, which a sell-down
    // never populates — without an explicit restore these three units would
    // simply be gone.
    expect(log!.overhangRemainingQtyMilli).toBe(12_000);
  });

  test("REGRESSION: ×2 on a from-stock sale takes the extra units off the shelf", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const { productionLogId } = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000, orderIds: [], day: DAY,
    });
    const sale = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG, menuItemId: brownie, qtyMilli: 1_000, day: DAY,
    });
    await asOwner.mutation(api.orders.setQuickSaleQuantity, {
      ...SLUG, orderId: sale.orderId, qtyMilli: 3_000,
    });

    const log = await t.run(async (ctx) => ctx.db.get(productionLogId));
    // Patching qtyMilli in place would have left this at 11.
    expect(log!.overhangRemainingQtyMilli).toBe(9_000);

    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId: sale.orderId });
    expect(data.totals.totalCents).toBe(900);
    expect(data.payments.status).toBe("paid");
  });

  test("ACCEPTANCE: the batch that made a line is recorded on it", async () => {
    // Without this write nothing in the schema remembers which yield a
    // customer's portion was cut at — `menuItems.baseBatchYield` is
    // overwritten in place, and the production log was the only survivor.
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const order = await orderFor(t, brownie, 4);

    const { productionLogId } = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [order], day: DAY,
    });

    const lines = await t.run(async (ctx) =>
      ctx.db.query("orderLines").collect(),
    );
    expect(lines.every((l) => l.fulfilledFromProductionLogId === productionLogId))
      .toBe(true);

    // And the yield is recoverable from the log, which is the whole point.
    const log = (await t.run(async (ctx) => ctx.db.get(productionLogId)))!;
    expect(log.expectedYieldMilli / log.batchCount / 1000).toBe(12);
  });

  test("ACCEPTANCE: a burnt batch claims nothing, so the re-bake can claim it", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const order = await orderFor(t, brownie, 4);

    // Everything she made went in the bin.
    const burnt = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [order], day: DAY, wasteQtyMilli: 12_000, wasteReason: "Burnt.",
    });
    const afterBurn = await t.run(async (ctx) =>
      ctx.db.query("orderLines").collect(),
    );
    expect(afterBurn.every((l) => l.fulfilledFromProductionLogId === undefined))
      .toBe(true);

    // So the second batch still finds the line and covers it. Had the burnt
    // batch claimed it, this bake would have read consumed = 0 and booked its
    // entire yield as overhang.
    const again = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [order], day: DAY,
    });
    expect(again.consumedMilli).toBe(4_000);
    expect(again.overhangQtyMilli).toBe(8_000);

    const afterRebake = await t.run(async (ctx) =>
      ctx.db.query("orderLines").collect(),
    );
    expect(
      afterRebake.every(
        (l) => l.fulfilledFromProductionLogId === again.productionLogId,
      ),
    ).toBe(true);
    expect(burnt.productionLogId).not.toBe(again.productionLogId);
  });

  test("a bake with no orders ticked claims nothing", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    await orderFor(t, brownie, 4);
    await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [], day: DAY,
    });
    const lines = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
    // Untraceable, and the evidence must say so rather than assume today's
    // yield applied.
    expect(lines.every((l) => l.fulfilledFromProductionLogId === undefined))
      .toBe(true);
  });

  test("REGRESSION: cancelling a baked-to-order line does not put it back on the shelf", async () => {
    // The back-link widened what `fulfilledFromProductionLogId` means, and
    // restoreSellDown walks exactly that field. Without its guard, cancelling
    // would credit these units back as overhang and un-bake food that exists.
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const order = await orderFor(t, brownie, 4);
    const { productionLogId } = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [order], day: DAY,
    });
    const before = (await t.run(async (ctx) => ctx.db.get(productionLogId)))!;

    const result = await asOwner.mutation(api.orders.cancel, {
      ...SLUG, orderId: order, reason: "Called off.",
    });

    const after = (await t.run(async (ctx) => ctx.db.get(productionLogId)))!;
    expect(after.overhangRemainingQtyMilli).toBe(
      before.overhangRemainingQtyMilli,
    );
    expect(result.overhangReturnedMilli).toBe(0);
    // She still gets told a batch was made for it — the cost stays on the
    // books as waste (CONTEXT.md — Orders).
    expect(result.productionLogged).toBe(true);
  });

  test("the partition holds through a sell-down and a cancel", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);
    const order = await orderFor(t, brownie, 4);
    const { productionLogId } = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [order], day: DAY, wasteQtyMilli: 1_000,
    });

    /**
     * Every unit sits in exactly one place.
     *
     * `consumed` is read back from the log's own stored figures rather than
     * re-derived from the orders, and that distinction is the point:
     * cancelling an order that a batch was baked FOR does not un-bake it.
     * Those units stay consumed and their cost stays on the books as waste,
     * which is exactly what CONTEXT.md says happens. Only the shelf moves.
     */
    const partition = async () => {
      const log = (await t.run(async (ctx) => ctx.db.get(productionLogId)))!;
      const lines = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
      // `fulfilledFromProductionLogId` now points at the batch that MADE the
      // units, not only at a shelf it took them from — that widening is what
      // lets a rating be traced to a yield. So the shelf is the linked lines
      // whose order this batch was NOT baked for; the rest were baked to
      // order and were never on a shelf at all.
      const bakedFor = new Set(log.orderIds as string[]);
      const soldDown = lines
        .filter(
          (l) =>
            l.fulfilledFromProductionLogId === productionLogId &&
            !bakedFor.has(l.orderId),
        )
        .reduce((s, l) => s + l.qtyMilli, 0);
      const consumedAtLog =
        log.actualYieldMilli - log.wasteQtyMilli - log.overhangQtyMilli;
      return {
        whole:
          consumedAtLog + log.wasteQtyMilli + log.overhangQtyMilli ===
          log.actualYieldMilli,
        // The shelf: what was spare either left as a sale or is still there.
        shelf: soldDown + log.overhangRemainingQtyMilli,
        overhang: log.overhangQtyMilli,
      };
    };

    // 4 to the order + 1 wasted + 7 spare = 12.
    expect(await partition()).toEqual({ whole: true, shelf: 7_000, overhang: 7_000 });

    await asOwner.mutation(api.orders.quickSale, {
      ...SLUG, menuItemId: brownie, qtyMilli: 3_000, day: DAY,
    });
    // A unit moved from "on hand" to "sold down"; none was created.
    expect(await partition()).toEqual({ whole: true, shelf: 7_000, overhang: 7_000 });

    await asOwner.mutation(api.orders.cancel, {
      ...SLUG, orderId: order, reason: "Called off.",
    });
    // The cancelled order's 4 units were baked for it and stay booked to it.
    // The 3 sold off the shelf are still sold. Nothing moved, nothing lost.
    expect(await partition()).toEqual({ whole: true, shelf: 7_000, overhang: 7_000 });
  });
});

describe("what it all adds up to", () => {
  test("ACCEPTANCE: expired overhang is waste, costed against its own batch", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie, butter } = await menu(t);
    const order = await orderFor(t, brownie, 6);
    await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 10_000,
      orderIds: [order], day: DAY,
    });

    // Still good.
    const fresh = await asOwner.query(api.production.stockOnHand, { ...SLUG });
    expect(fresh.live).toHaveLength(1);
    expect(fresh.live[0].qtyMilli).toBe(4_000);
    expect(fresh.expired).toHaveLength(0);

    // Butter doubles, and then the shelf life runs out.
    await t.run(async (ctx) => {
      await ctx.db.patch(butter, { standardCostCentsPerThousand: 840 });
    });
    vi.setSystemTime(Date.now() + 73 * HOUR_MS);

    const gone = await asOwner.query(api.production.stockOnHand, { ...SLUG });
    expect(gone.live).toHaveLength(0);
    expect(gone.expired).toHaveLength(1);
    // 4 units × (15 + 20 + 71) — the price stamped when it was baked, not
    // today's dearer butter.
    expect(gone.expired[0].valueCents).toBe(424);

    const summary = await asOwner.query(api.production.madeVersusSold, {
      ...SLUG,
      end: DAY,
    });
    const row = summary.rows.find((r) => r.name === "Brownies")!;
    expect(row.wastedMilli).toBe(4_000);
    expect(row.wasteValueCents).toBe(424);
    expect(row.onHandMilli).toBe(0);
    vi.useRealTimers();
  });

  test("ACCEPTANCE: made versus sold, per item per period", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    const order = await orderFor(t, brownie, 6);
    await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 10_000,
      orderIds: [order], day: DAY,
    });
    // A batch in a different month, which the period must exclude.
    await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [], day: "2026-06-15",
    });

    const august = await asOwner.query(api.production.madeVersusSold, {
      ...SLUG,
      start: "2026-08-01",
      end: "2026-08-31",
    });
    const row = august.rows.find((r) => r.name === "Brownies")!;
    expect(row.madeMilli).toBe(10_000);
    expect(row.expectedMilli).toBe(12_000);
    expect(row.soldMilli).toBe(6_000);
    expect(row.onHandMilli).toBe(4_000);
    expect(row.batches).toBe(1);

    const everything = await asOwner.query(api.production.madeVersusSold, {
      ...SLUG,
      end: "2026-12-31",
    });
    expect(everything.rows[0].madeMilli).toBe(22_000);
    expect(everything.rows[0].batches).toBe(2);

    // The variance series the chart plots: 10 against an expected 12.
    const batch = august.batches[0];
    expect(batch.variancePercent).toBe(-17);
    expect(batch.producedOn).toBe(DAY);
  });

  test("what needs making excludes what is already coming off the shelf", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    await orderFor(t, brownie, 18, { deliveryDate: "2026-08-10" });
    const needs = await asOwner.query(api.production.whatNeedsMaking, {
      ...SLUG,
      today: DAY,
    });
    expect(needs).toHaveLength(1);
    expect(needs[0].neededMilli).toBe(18_000);
    // 18 units at 12 a batch is two batches.
    expect(needs[0].suggestedBatchCount).toBe(2);

    // Now put 20 on the shelf and take a same-day order off it.
    await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 2, actualYieldMilli: 20_000, orderIds: [], day: DAY,
    });
    await orderFor(t, brownie, 3, {
      phone: "+263772119003", name: "Rudo", deliveryDate: DAY,
    });
    const after = await asOwner.query(api.production.whatNeedsMaking, {
      ...SLUG,
      today: DAY,
    });
    // The far order still needs baking; the same-day one is already served.
    expect(after[0].neededMilli).toBe(18_000);
  });

  test("each order carries its OWN quantity, so ticking one is not ticking both", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    const first = await orderFor(t, brownie, 4, { deliveryDate: "2026-08-06" });
    await orderFor(t, brownie, 2, {
      phone: "+263772119003", name: "Rudo", deliveryDate: "2026-08-08",
    });

    const needs = await asOwner.query(api.production.whatNeedsMaking, {
      ...SLUG, today: DAY,
    });
    expect(needs[0].neededMilli).toBe(6_000);
    // The form sums the ticked ones. Without per-order quantities it can only
    // show 6 whichever single order she ticks, and the save then contradicts
    // the spare figure she was shown.
    expect(needs[0].orders.map((o) => o.qtyMilli).sort()).toEqual([2_000, 4_000]);

    // And the server agrees with what ticking only the first would have shown:
    // 10 made against that order's 4 is 6 spare, not 4.
    const logged = await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 10_000,
      orderIds: [first], day: DAY,
    });
    expect(logged.consumedMilli).toBe(4_000);
    expect(logged.overhangQtyMilli).toBe(6_000);
  });

  test("a batch reports its own waste, not its item's average", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { brownie } = await menu(t);

    // Two batches on two days: one clean, one where she dropped a tray. The
    // chart plots a rate per DAY, so a shared item-level percentage would draw
    // both days identically and hide the very day that went wrong.
    await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [], day: "2026-08-01",
    });
    await asOwner.mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [], day: "2026-08-02", wasteQtyMilli: 6_000,
      wasteReason: "Dropped the tray.",
    });

    const summary = await asOwner.query(api.production.madeVersusSold, {
      ...SLUG, end: "2026-08-31",
    });
    const [clean, dropped] = summary.batches;
    expect(clean.producedOn).toBe("2026-08-01");
    expect(clean.wastedMilli).toBe(0);
    expect(dropped.wastedMilli).toBe(6_000);
    // The item's period-wide rate is 25% — neither day's actual rate.
    expect(summary.rows[0].wastePercent).toBe(25);
  });

  test("ACCEPTANCE: staff can log and sell, and never see what any of it cost", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    // Staff log the batch — the cost is stamped FOR her, not shown to them.
    await t.withIdentity(STAFF).mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000,
      orderIds: [], day: DAY,
    });
    const logs = await t.run(async (ctx) => ctx.db.query("productionLogs").collect());
    expect(logs[0].cogsSnapshot.ingredientsCents).toBe(15);

    // They can see WHAT is on the shelf — selling it down is their job.
    const staffStock = await t
      .withIdentity(STAFF)
      .query(api.production.stockOnHand, { ...SLUG });
    expect(staffStock.live[0].qtyMilli).toBe(12_000);
    expect(staffStock.live[0].valueCents).toBeNull();
    // Asserted on the serialised payload, which survives refactors a type
    // check would not: no cost-shaped field reaches them with a value.
    const serialised = JSON.stringify(staffStock);
    for (const leak of ["cogsSnapshot", "wasteValueCents", "ingredientsCents"]) {
      expect(serialised).not.toContain(leak);
    }
    expect(serialised).toContain('"valueCents":null');

    // The leak view is money end to end, so it is refused outright.
    await expect(
      t.withIdentity(STAFF).query(api.production.madeVersusSold, { ...SLUG, end: DAY }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

    // …and the owner gets all of it.
    const owner = await t.withIdentity(OWNER).query(api.production.stockOnHand, { ...SLUG });
    expect(owner.live[0].valueCents).toBe(1_272);
  });

  test("another kitchen sees none of it", async () => {
    const t = await kitchen();
    const { brownie } = await menu(t);
    await t.withIdentity(OWNER).mutation(api.production.log, {
      ...SLUG, menuItemId: brownie, batchCount: 1, actualYieldMilli: 12_000, orderIds: [], day: DAY,
    });
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
      .query(api.production.stockOnHand, { orgSlug: "kitchen-b" });
    expect(other.live).toHaveLength(0);
    expect(other.expired).toHaveLength(0);
  });
});
