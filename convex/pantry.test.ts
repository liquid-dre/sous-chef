import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Pantry acceptance (see the slice plan):
 * - repeat-last-shop reproduces a real basket and skips emergency dashes;
 * - drift on an ingredient used only inside a SUB-recipe flags the parent;
 * - adopting a new standard cost leaves orderLine cogsSnapshots
 *   byte-identical — history never moves.
 */

const OWNER = {
  subject: "user_owner",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:admin",
};
const STAFF = { ...OWNER, subject: "user_staff", org_role: "org:member" };
const SLUG = { orgSlug: "kitchen-a" };
const DAY = 86_400_000;
/** Her day. The server has no "today" — Convex runs UTC (lib/day.ts). */
const TODAY = "2026-08-05";

async function provisioned() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  await t
    .withIdentity({ subject: "user_super" })
    .mutation(api.admin.provisionOrg, {
      orgId: "org_kitchen_a",
      slug: "kitchen-a",
      name: "Kitchen A",
    });
  return t;
}

async function addIngredient(
  t: ReturnType<typeof convexTest>,
  name: string,
  centsPerThousand: number,
  opts: { trackStock?: boolean; setAt?: number } = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: "org_kitchen_a",
      name,
      baseUnit: "g" as const,
      standardCostCentsPerThousand: centsPerThousand,
      standardCostSetAt: opts.setAt ?? Date.now(),
      trackStock: opts.trackStock ?? true,
      alertsMuted: false,
    }),
  );
}

beforeEach(() => vi.unstubAllEnvs());

describe("purchase entry", () => {
  test("derives unit price: 2kg flour at $3.70 is $1.85/kg, and stocks it", async () => {
    const t = await provisioned();
    const flour = await addIngredient(t, "Flour", 185);
    const asOwner = t.withIdentity(OWNER);

    await asOwner.mutation(api.purchases.createBatch, {
      ...SLUG,
      lines: [
        { ingredientId: flour, packQtyMilli: 2_000, packUnit: "kg", priceCents: 370 },
      ],
    });

    const { purchase, movement, ingredient } = await t.run(async (ctx) => ({
      purchase: await ctx.db.query("purchases").first(),
      movement: await ctx.db.query("stockMovements").first(),
      ingredient: await ctx.db.get(flour),
    }));
    expect(purchase!.unitPriceCentsPerThousand).toBe(185);
    expect(purchase!.qtyBaseMilli).toBe(2_000_000);
    // One action, two effects — and the second effect is an APPEND, not a
    // level. The pantry figure is the sum of these rows (convex/lib/stock.ts).
    expect(movement!.reason).toBe("purchase");
    expect(movement!.deltaMilli).toBe(2_000_000);
    const levels = await asOwner.query(api.ingredients.list, {
      ...SLUG,
      today: TODAY,
    });
    expect(levels.rows.find((r) => r.id === flour)!.levelMilli).toBe(2_000_000);
    // A delivery arriving is not somebody standing in the pantry looking at
    // the tub, so it must NOT anchor freshness.
    expect(ingredient!.stockAsOf).toBeUndefined();
  });

  test("a don't-track-stock ingredient records the purchase but no level", async () => {
    const t = await provisioned();
    const salt = await addIngredient(t, "Salt", 90, { trackStock: false });
    const asOwner = t.withIdentity(OWNER);

    await asOwner.mutation(api.purchases.createBatch, {
      ...SLUG,
      lines: [
        { ingredientId: salt, packQtyMilli: 1_000, packUnit: "kg", priceCents: 140 },
      ],
    });

    const { purchases, movements } = await t.run(async (ctx) => ({
      purchases: await ctx.db.query("purchases").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
    }));
    expect(purchases).toHaveLength(1); // the record still exists
    expect(movements).toHaveLength(0); // but nothing pretends to be a level
    // Not zero — NULL. Salt is costed and never counted, and a zero would
    // read as "you have run out" (CONTEXT.md — Pantry).
    const levels = await asOwner.query(api.ingredients.list, {
      ...SLUG,
      today: TODAY,
    });
    expect(levels.rows.find((r) => r.id === salt)!.levelMilli).toBeNull();
  });

  test("inline ingredient creation seeds standard cost from that line", async () => {
    const t = await provisioned();
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.purchases.createBatch, {
      ...SLUG,
      lines: [
        {
          newIngredient: { name: "Butter", baseUnit: "g" },
          packQtyMilli: 500_000,
          packUnit: "g",
          priceCents: 210,
        },
      ],
    });
    const created = await t.run(async (ctx) =>
      ctx.db.query("ingredients").first(),
    );
    // $2.10 for 500g → $4.20/kg
    expect(created!.name).toBe("Butter");
    expect(created!.standardCostCentsPerThousand).toBe(420);
    expect(created!.trackStock).toBe(true);
  });

  test("a pack unit from another family is refused", async () => {
    const t = await provisioned();
    const flour = await addIngredient(t, "Flour", 185); // measured in g
    const asOwner = t.withIdentity(OWNER);
    await expect(
      asOwner.mutation(api.purchases.createBatch, {
        ...SLUG,
        lines: [
          { ingredientId: flour, packQtyMilli: 1_000, packUnit: "L", priceCents: 100 },
        ],
      }),
    ).rejects.toThrow(/can't be recorded against/);
  });

  test("staff never reach purchase entry", async () => {
    const t = await provisioned();
    const flour = await addIngredient(t, "Flour", 185);
    await expect(
      t.withIdentity(STAFF).mutation(api.purchases.createBatch, {
        ...SLUG,
        lines: [
          { ingredientId: flour, packQtyMilli: 1_000, packUnit: "kg", priceCents: 185 },
        ],
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });
});

describe("repeat last shop", () => {
  test("ACCEPTANCE: reproduces the previous basket, quantities and prices intact", async () => {
    const t = await provisioned();
    const flour = await addIngredient(t, "Flour", 185);
    const butter = await addIngredient(t, "Butter", 420);
    const sugar = await addIngredient(t, "Sugar", 150);
    const asOwner = t.withIdentity(OWNER);

    await asOwner.mutation(api.purchases.createBatch, {
      ...SLUG,
      purchasedAt: Date.now() - 7 * DAY,
      lines: [
        { ingredientId: flour, packQtyMilli: 2_000, packUnit: "kg", priceCents: 370 },
        { ingredientId: butter, packQtyMilli: 500_000, packUnit: "g", priceCents: 210 },
        { ingredientId: sugar, packQtyMilli: 1_000, packUnit: "kg", priceCents: 150 },
      ],
    });

    const shop = await asOwner.query(api.purchases.lastShop, SLUG);
    expect(shop).not.toBeNull();
    expect(shop!.lineCount).toBe(3);
    expect(shop!.totalCents).toBe(370 + 210 + 150);
    expect(shop!.lines.map((l) => l.name)).toEqual(["Butter", "Flour", "Sugar"]);
    // Editable prefill: every field she needs comes back.
    const flourLine = shop!.lines.find((l) => l.name === "Flour")!;
    expect(flourLine.packQtyMilli).toBe(2_000);
    expect(flourLine.packUnit).toBe("kg");
    expect(flourLine.priceCents).toBe(370);
  });

  test("ACCEPTANCE: an emergency one-item dash is skipped for the last real shop", async () => {
    const t = await provisioned();
    const flour = await addIngredient(t, "Flour", 185);
    const butter = await addIngredient(t, "Butter", 420);
    const sugar = await addIngredient(t, "Sugar", 150);
    const asOwner = t.withIdentity(OWNER);

    await asOwner.mutation(api.purchases.createBatch, {
      ...SLUG,
      purchasedAt: Date.now() - 7 * DAY,
      lines: [
        { ingredientId: flour, packQtyMilli: 2_000, packUnit: "kg", priceCents: 370 },
        { ingredientId: butter, packQtyMilli: 500_000, packUnit: "g", priceCents: 210 },
        { ingredientId: sugar, packQtyMilli: 1_000, packUnit: "kg", priceCents: 150 },
      ],
    });
    // Yesterday: ran out of butter, dashed to the corner shop.
    await asOwner.mutation(api.purchases.createBatch, {
      ...SLUG,
      purchasedAt: Date.now() - 1 * DAY,
      lines: [
        { ingredientId: butter, packQtyMilli: 250_000, packUnit: "g", priceCents: 190 },
      ],
    });

    const shop = await asOwner.query(api.purchases.lastShop, SLUG);
    expect(shop!.lineCount).toBe(3); // the real shop, not the dash
  });

  test("a kitchen that has never shopped gets null, not an empty basket", async () => {
    const t = await provisioned();
    expect(await t.withIdentity(OWNER).query(api.purchases.lastShop, SLUG)).toBeNull();
  });
});

describe("cost drift", () => {
  async function buy(
    t: ReturnType<typeof convexTest>,
    ingredientId: Id<"ingredients">,
    priceCents: number,
    daysAgo: number,
  ) {
    await t.withIdentity(OWNER).mutation(api.purchases.createBatch, {
      ...SLUG,
      purchasedAt: Date.now() - daysAgo * DAY,
      lines: [{ ingredientId, packQtyMilli: 1_000, packUnit: "kg", priceCents }],
    });
  }

  test("one spike does not fire; three consecutive highs do", async () => {
    const t = await provisioned();
    const butter = await addIngredient(t, "Butter", 420);
    const asOwner = t.withIdentity(OWNER);

    await buy(t, butter, 420, 30);
    await buy(t, butter, 425, 20);
    await buy(t, butter, 840, 10); // panic buy at double
    let row = (await asOwner.query(api.ingredients.list, { ...SLUG, today: TODAY })).rows[0];
    expect(row.drift.medianCentsPerThousand).toBe(425);
    expect(row.drift.drifted).toBe(false);

    // Now the market really has moved.
    await buy(t, butter, 500, 5);
    await buy(t, butter, 510, 2);
    row = (await asOwner.query(api.ingredients.list, { ...SLUG, today: TODAY })).rows[0];
    expect(row.drift.medianCentsPerThousand).toBe(510); // median of 840,500,510
    expect(row.drift.drifted).toBe(true);
  });

  test("under three purchases there is no signal, and the charts know it", async () => {
    const t = await provisioned();
    const flour = await addIngredient(t, "Flour", 185);
    await buy(t, flour, 250, 3);
    const list = await t.withIdentity(OWNER).query(api.ingredients.list, { ...SLUG, today: TODAY });
    expect(list.rows[0].drift.hasEnoughData).toBe(false);
    expect(list.rows[0].drift.percent).toBeNull();
    expect(list.anyDriftComputable).toBe(false);
  });

  test("staleness fires on the clock alone, with no purchases at all", async () => {
    const t = await provisioned();
    await addIngredient(t, "Vanilla", 9000, { setAt: Date.now() - 120 * DAY });
    const list = await t.withIdentity(OWNER).query(api.ingredients.list, { ...SLUG, today: TODAY });
    expect(list.rows[0].drift.stale).toBe(true);
    expect(list.rows[0].needsAttention).toBe(true);
  });

  test("a muted ingredient still computes drift but never asks for attention", async () => {
    const t = await provisioned();
    const butter = await addIngredient(t, "Butter", 420);
    await t.run(async (ctx) => ctx.db.patch(butter, { alertsMuted: true }));
    await buy(t, butter, 600, 30);
    await buy(t, butter, 610, 20);
    await buy(t, butter, 620, 10);
    const row = (await t.withIdentity(OWNER).query(api.ingredients.list, { ...SLUG, today: TODAY })).rows[0];
    expect(row.drift.drifted).toBe(true);
    expect(row.needsAttention).toBe(false);
  });

  test("drift applies to don't-track-stock ingredients too", async () => {
    const t = await provisioned();
    const salt = await addIngredient(t, "Salt", 90, { trackStock: false });
    await buy(t, salt, 140, 30);
    await buy(t, salt, 145, 20);
    await buy(t, salt, 150, 10);
    const row = (await t.withIdentity(OWNER).query(api.ingredients.list, { ...SLUG, today: TODAY })).rows[0];
    expect(row.trackStock).toBe(false);
    expect(row.drift.drifted).toBe(true); // costed, so it can drift
  });

  test("adoptMedian refuses while the evidence is thin", async () => {
    const t = await provisioned();
    const flour = await addIngredient(t, "Flour", 185);
    await buy(t, flour, 250, 2);
    await expect(
      t.withIdentity(OWNER).mutation(api.ingredients.adoptMedian, {
        ...SLUG,
        ingredientId: flour,
      }),
    ).rejects.toThrow(/needs 3 purchases/);
  });
});

describe("drift reaches menu items", () => {
  /** Cake → Buttercream (sub-recipe) → Butter. The cake never mentions
   * butter directly; only the sub-recipe does. */
  async function nestedKitchen(t: ReturnType<typeof convexTest>) {
    const butter = await addIngredient(t, "Butter", 420);
    const ids = await t.run(async (ctx) => {
      const buttercream = await ctx.db.insert("menuItems", {
        orgId: "org_kitchen_a",
        name: "Buttercream",
        notSoldDirectly: true,
        baseBatchYield: 10,
        unitWeightMilligrams: 100_000,
        perUnitExtras: [],
        sensoryAxes: [],
        batchProductionMinutes: 20,
      });
      const cake = await ctx.db.insert("menuItems", {
        orgId: "org_kitchen_a",
        name: "Chocolate fudge cake",
        notSoldDirectly: false,
        baseBatchYield: 1,
        unitWeightMilligrams: 1_200_000,
        priceCents: 3200,
        targetGrossMarginPercent: 65,
        perUnitExtras: [{ label: "Box", costCents: 120 }],
        sensoryAxes: [],
        batchProductionMinutes: 150,
      });
      // Buttercream's batch uses 1kg of butter.
      await ctx.db.insert("recipeLines", {
        orgId: "org_kitchen_a",
        menuItemId: buttercream,
        componentType: "ingredient",
        componentId: butter,
        qtyMilli: 1_000_000,
        unit: "g",
      });
      // The cake uses 2 units of buttercream.
      await ctx.db.insert("recipeLines", {
        orgId: "org_kitchen_a",
        menuItemId: cake,
        componentType: "menuItem",
        componentId: buttercream,
        qtyMilli: 2_000,
        unit: "unit",
      });
      return { buttercream, cake };
    });
    return { butter, ...ids };
  }

  test("ACCEPTANCE: drift on a sub-recipe's ingredient flags the parent menu item", async () => {
    const t = await provisioned();
    const { butter, cake } = await nestedKitchen(t);
    const asOwner = t.withIdentity(OWNER);

    // Butter climbs across three shops: $4.20 → ~$6.20/kg.
    for (const [price, daysAgo] of [
      [600, 30],
      [620, 20],
      [640, 10],
    ] as const) {
      await asOwner.mutation(api.purchases.createBatch, {
        ...SLUG,
        purchasedAt: Date.now() - daysAgo * DAY,
        lines: [
          { ingredientId: butter, packQtyMilli: 1_000, packUnit: "kg", priceCents: price },
        ],
      });
    }

    const affected = await asOwner.query(api.menuItems.driftAffected, SLUG);
    expect(affected.anyDrift).toBe(true);
    // The CAKE is flagged, not just the buttercream — and the sub-recipe
    // itself is never listed, since it has no price of its own.
    expect(affected.items.map((i) => i.name)).toEqual(["Chocolate fudge cake"]);

    const item = affected.items[0];
    expect(item.id).toBe(cake);
    expect(item.ifAdopted.grossPercent).toBeLessThan(item.now.grossPercent!);
    expect(item.causes).toHaveLength(1);
    expect(item.causes[0].name).toBe("Butter");
    // It names the path it travelled.
    expect(item.causes[0].via).toBe("Buttercream");
  });

  test("a steady pantry flags nothing", async () => {
    const t = await provisioned();
    const { butter } = await nestedKitchen(t);
    const asOwner = t.withIdentity(OWNER);
    for (const daysAgo of [30, 20, 10]) {
      await asOwner.mutation(api.purchases.createBatch, {
        ...SLUG,
        purchasedAt: Date.now() - daysAgo * DAY,
        lines: [
          { ingredientId: butter, packQtyMilli: 1_000, packUnit: "kg", priceCents: 420 },
        ],
      });
    }
    const affected = await asOwner.query(api.menuItems.driftAffected, SLUG);
    expect(affected.anyDrift).toBe(false);
    expect(affected.items).toEqual([]);
  });

  test("a recipe cycle terminates instead of recursing forever", async () => {
    const t = await provisioned();
    const { butter, buttercream, cake } = await nestedKitchen(t);
    // Buttercream now (nonsensically) contains the cake.
    await t.run(async (ctx) =>
      ctx.db.insert("recipeLines", {
        orgId: "org_kitchen_a",
        menuItemId: buttercream,
        componentType: "menuItem",
        componentId: cake,
        qtyMilli: 1_000,
        unit: "unit",
      }),
    );
    const asOwner = t.withIdentity(OWNER);
    for (const [price, daysAgo] of [
      [600, 30],
      [620, 20],
      [640, 10],
    ] as const) {
      await asOwner.mutation(api.purchases.createBatch, {
        ...SLUG,
        purchasedAt: Date.now() - daysAgo * DAY,
        lines: [
          { ingredientId: butter, packQtyMilli: 1_000, packUnit: "kg", priceCents: price },
        ],
      });
    }
    const affected = await asOwner.query(api.menuItems.driftAffected, SLUG);
    expect(affected.items).toHaveLength(1);
  });
});

describe("standard cost and history", () => {
  test("ACCEPTANCE: adopting a new standard cost leaves cogsSnapshots byte-identical", async () => {
    const t = await provisioned();
    const butter = await addIngredient(t, "Butter", 420);
    const asOwner = t.withIdentity(OWNER);

    // A sale that snapshotted its cost of goods at the time.
    const { orderLineId, before } = await t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: "org_kitchen_a",
        name: "Tariro Moyo",
        phone: "+263715550184",
        marketingConsent: true,
        consentSource: "order",
      });
      const orderId = await ctx.db.insert("orders", {
        orgId: "org_kitchen_a",
        customerId,
        orderDate: "2026-07-01",
        deliveryDate: "2026-07-03",
        status: "delivered",
        deliveryFeeCents: 500,
        deliveryCostCents: 240,
        discountCents: 0,
        taxInclusiveAtCreation: false,
        taxRateBpAtCreation: 0,
        invoiceNumber: 1,
        revision: 0,
        source: "app",
        feedbackToken: "fb_1",
        invoiceToken: "inv_1",
      });
      const lineId = await ctx.db.insert("orderLines", {
        orgId: "org_kitchen_a",
        orderId,
        qtyMilli: 1_000,
        unitPriceCents: 3200,
        cogsSnapshot: {
          ingredientsCents: 810,
          perUnitExtrasCents: 120,
          overheadCents: 230,
        },
        uncosted: false,
      });
      const line = await ctx.db.get(lineId);
      return { orderLineId: lineId, before: JSON.stringify(line!.cogsSnapshot) };
    });

    // Butter doubles over three shops; she adopts the median.
    for (const [price, daysAgo] of [
      [820, 30],
      [840, 20],
      [860, 10],
    ] as const) {
      await asOwner.mutation(api.purchases.createBatch, {
        ...SLUG,
        purchasedAt: Date.now() - daysAgo * DAY,
        lines: [
          { ingredientId: butter, packQtyMilli: 1_000, packUnit: "kg", priceCents: price },
        ],
      });
    }
    const result = await asOwner.mutation(api.ingredients.adoptMedian, {
      ...SLUG,
      ingredientId: butter,
    });
    expect(result.adoptedCentsPerThousand).toBe(840);

    const after = await t.run(async (ctx) =>
      JSON.stringify((await ctx.db.get(orderLineId))!.cogsSnapshot),
    );
    // Byte-identical. History does not move. (Serialised key order is
    // Convex's, so this compares the stored bytes with themselves rather
    // than with a hand-written literal.)
    expect(after).toBe(before);
    expect(JSON.parse(after)).toEqual({
      ingredientsCents: 810,
      perUnitExtrasCents: 120,
      overheadCents: 230,
    });

    // And the drift signal is gone, with nothing to "resolve".
    const row = (await asOwner.query(api.ingredients.list, { ...SLUG, today: TODAY })).rows[0];
    expect(row.standardCostCentsPerThousand).toBe(840);
    expect(row.drift.drifted).toBe(false);
  });

  test("base unit locks once anything references the ingredient", async () => {
    const t = await provisioned();
    const flour = await addIngredient(t, "Flour", 185);
    const asOwner = t.withIdentity(OWNER);

    // Free to change while nothing depends on the meaning of its quantities.
    await asOwner.mutation(api.ingredients.update, {
      ...SLUG,
      ingredientId: flour,
      baseUnit: "ml",
    });

    await asOwner.mutation(api.purchases.createBatch, {
      ...SLUG,
      lines: [
        { ingredientId: flour, packQtyMilli: 1_000, packUnit: "L", priceCents: 185 },
      ],
    });

    await expect(
      asOwner.mutation(api.ingredients.update, {
        ...SLUG,
        ingredientId: flour,
        baseUnit: "g",
      }),
    ).rejects.toThrow(/unit can't change/);
  });

  test("price history is oldest-first and carries % from standard for the chart", async () => {
    const t = await provisioned();
    const butter = await addIngredient(t, "Butter", 400);
    const asOwner = t.withIdentity(OWNER);
    for (const [price, daysAgo] of [
      [400, 30],
      [440, 20],
      [460, 10],
    ] as const) {
      await asOwner.mutation(api.purchases.createBatch, {
        ...SLUG,
        purchasedAt: Date.now() - daysAgo * DAY,
        lines: [
          { ingredientId: butter, packQtyMilli: 1_000, packUnit: "kg", priceCents: price },
        ],
      });
    }
    const detail = await asOwner.query(api.ingredients.get, {
      ...SLUG,
      ingredientId: butter,
    });
    expect(detail.history).toHaveLength(3);
    expect(detail.history[0].purchasedAt).toBeLessThan(
      detail.history[2].purchasedAt,
    );
    expect(detail.history.map((h) => h.percentFromStandard)).toEqual([0, 10, 15]);
  });
});
