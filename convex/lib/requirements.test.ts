// @vitest-environment node
import { describe, expect, test } from "vitest";
import { batchesFor, requiredFor, requiredForAll } from "./requirements";
import type { CostingWorld, CostingItem, CostingLine } from "./costing";

/**
 * Where a confidently wrong alert would be born.
 *
 * The test that carries the slice is the first one: six units of buttercream
 * on the shelf and an order that needs four must require ZERO butter. Get
 * that wrong and Sous tells her to buy butter she will not open — and
 * CONTEXT.md is explicit that two wrong alerts and she mutes the system
 * forever. The second is the rounding: eight units short of a sub that yields
 * ten is ONE WHOLE BATCH of butter, not eight tenths of one, because a whole
 * batch is the only thing she can log.
 */

const KG = 1_000_000; // milli-base-units in a kilogram

function item(
  id: string,
  over: Partial<CostingItem> & { lines: CostingLine[] },
): CostingItem {
  return {
    id,
    name: id,
    notSoldDirectly: false,
    baseBatchYield: 10,
    unitWeightMilligrams: 85_000,
    batchProductionMinutes: 60,
    perUnitExtras: [],
    ...over,
  };
}

function ing(id: string, componentId: string, qtyMilli: number): CostingLine {
  return { componentType: "ingredient", componentId, qtyMilli };
}

function sub(componentId: string, qtyMilli: number): CostingLine {
  return { componentType: "menuItem", componentId, qtyMilli };
}

/**
 * Brownies: 12 a batch, 500 g flour + 2 units of buttercream.
 * Buttercream: 10 a batch, 1 kg butter.
 * The same shape convex/production.test.ts builds, so the two suites are
 * talking about the same kitchen.
 */
function kitchen(): CostingWorld {
  return {
    items: {
      brownie: item("brownie", {
        baseBatchYield: 12,
        lines: [sub("buttercream", 2_000), ing("brownie", "flour", 500_000)],
      }),
      buttercream: item("buttercream", {
        notSoldDirectly: true,
        baseBatchYield: 10,
        lines: [ing("buttercream", "butter", 1 * KG)],
      }),
    },
    ingredients: {
      flour: { id: "flour", name: "Flour", baseUnit: "g", standardCostCentsPerThousand: 185 },
      butter: { id: "butter", name: "Butter", baseUnit: "g", standardCostCentsPerThousand: 420 },
    },
    overheadRateCentsPerHour: 800,
  };
}

describe("the nested walk mirrors the deduction", () => {
  test("ACCEPTANCE: buttercream on the shelf means NO butter is required", () => {
    // Two batches of brownies want 4 units of buttercream. Six are on the
    // shelf. She will not open the butter, so Sous must not say she needs it.
    const shelf = new Map([["buttercream", 6_000]]);
    const need = requiredFor("brownie", 2, kitchen(), shelf);

    expect(need.ingredientMilli.get("butter")).toBeUndefined();
    expect(need.subBatches.size).toBe(0);
    // The flour is direct, so it is required regardless.
    expect(need.ingredientMilli.get("flour")).toBe(1 * KG);
    // And the shelf has been drawn down by exactly what was taken.
    expect(shelf.get("buttercream")).toBe(2_000);
  });

  test("ACCEPTANCE: a shortfall becomes WHOLE batches — 1 kg of butter, not 0.8", () => {
    // Seven batches of brownies want 14 units of buttercream; six are on the
    // shelf; 8 short. Buttercream yields 10 to a batch, so one whole batch
    // covers it — and one whole batch consumes a whole kilogram of butter.
    const shelf = new Map([["buttercream", 6_000]]);
    const need = requiredFor("brownie", 7, kitchen(), shelf);

    expect(need.subBatches.get("buttercream")).toBe(1);
    expect(need.ingredientMilli.get("butter")).toBe(1 * KG);
    // Emphatically not the proportional answer.
    expect(need.ingredientMilli.get("butter")).not.toBe(800_000);
  });

  test("the surplus from a forced batch goes back on the shelf", () => {
    // 8 short → 1 batch of 10 → 2 units spare, which WILL be overhang the
    // moment she logs it. A forecast that threw them away would demand a
    // second batch for the next order that needed one unit.
    const shelf = new Map([["buttercream", 6_000]]);
    requiredFor("brownie", 7, kitchen(), shelf);
    expect(shelf.get("buttercream")).toBe(2_000);
  });

  test("nothing on the shelf is the plain case", () => {
    const need = requiredFor("brownie", 1, kitchen(), new Map());
    expect(need.subBatches.get("buttercream")).toBe(1);
    expect(need.ingredientMilli.get("butter")).toBe(1 * KG);
    expect(need.ingredientMilli.get("flour")).toBe(500_000);
  });

  test("zero or negative batches require nothing", () => {
    expect(requiredFor("brownie", 0, kitchen(), new Map()).ingredientMilli.size).toBe(0);
    expect(requiredFor("brownie", -3, kitchen(), new Map()).ingredientMilli.size).toBe(0);
  });

  test("an unknown item requires nothing rather than throwing", () => {
    expect(requiredFor("ghost", 5, kitchen(), new Map()).ingredientMilli.size).toBe(0);
  });
});

describe("one shelf, shared", () => {
  test("ACCEPTANCE: two orders cannot both spend the same buttercream", () => {
    // Six on the shelf. Two orders of 2 batches each want 4 units apiece — 8
    // in total. Summed independently each would see the shelf cover it and
    // neither would ask for butter. Sharing the map is what stops that.
    const shelf = new Map([["buttercream", 6_000]]);
    const need = requiredForAll(
      [
        { itemId: "brownie", batchCount: 2 },
        { itemId: "brownie", batchCount: 2 },
      ],
      kitchen(),
      shelf,
    );
    // 8 wanted, 6 on the shelf, 2 short → one whole batch → 1 kg butter.
    expect(need.subBatches.get("buttercream")).toBe(1);
    expect(need.ingredientMilli.get("butter")).toBe(1 * KG);
    expect(need.ingredientMilli.get("flour")).toBe(2 * KG); // 4 batches × 500 g
  });

  test("the answer does not depend on the order the demands arrive in", () => {
    // An alert whose severity flipped because two orders swapped places
    // would be impossible to trust.
    const demands = [
      { itemId: "brownie", batchCount: 3 },
      { itemId: "brownie", batchCount: 1 },
      { itemId: "brownie", batchCount: 2 },
    ];
    const a = requiredForAll(demands, kitchen(), new Map([["buttercream", 5_000]]));
    const b = requiredForAll(
      [...demands].reverse(),
      kitchen(),
      new Map([["buttercream", 5_000]]),
    );
    expect([...a.ingredientMilli].sort()).toEqual([...b.ingredientMilli].sort());
    expect([...a.subBatches].sort()).toEqual([...b.subBatches].sort());
  });

  test("an empty order book requires nothing", () => {
    const need = requiredForAll([], kitchen(), new Map());
    expect(need.ingredientMilli.size).toBe(0);
    expect(need.truncated).toBe(false);
  });
});

describe("depth", () => {
  test("three levels resolve to the leaf", () => {
    // Cake → Icing → Syrup → sugar. Nothing on any shelf.
    const world: CostingWorld = {
      items: {
        cake: item("cake", { baseBatchYield: 1, lines: [sub("icing", 1_000)] }),
        icing: item("icing", { baseBatchYield: 1, lines: [sub("syrup", 1_000)] }),
        syrup: item("syrup", { baseBatchYield: 1, lines: [ing("syrup", "sugar", 250_000)] }),
      },
      ingredients: {
        sugar: { id: "sugar", name: "Sugar", baseUnit: "g", standardCostCentsPerThousand: 150 },
      },
      overheadRateCentsPerHour: 0,
    };
    const need = requiredFor("cake", 1, world, new Map());
    expect(need.ingredientMilli.get("sugar")).toBe(250_000);
    expect(need.subBatches.get("icing")).toBe(1);
    expect(need.subBatches.get("syrup")).toBe(1);
    expect(need.truncated).toBe(false);
  });

  test("ACCEPTANCE: a cycle terminates and says so rather than hanging", () => {
    // menuItems.save refuses to create this, but a forecast must not be the
    // thing that discovers otherwise by locking up a query.
    const world: CostingWorld = {
      items: {
        a: item("a", { baseBatchYield: 1, lines: [sub("b", 1_000)] }),
        b: item("b", { baseBatchYield: 1, lines: [sub("a", 1_000)] }),
      },
      ingredients: {},
      overheadRateCentsPerHour: 0,
    };
    const need = requiredFor("a", 1, world, new Map());
    // Truncation is REPORTED, never swallowed: figures below the cut are
    // missing, and a caller that hid that would publish a number it cannot
    // stand behind.
    expect(need.truncated).toBe(true);
  });
});

describe("batchesFor", () => {
  test("whole batches, rounded up, matching whatNeedsMaking", () => {
    expect(batchesFor(12_000, 12)).toBe(1);
    expect(batchesFor(13_000, 12)).toBe(2);
    expect(batchesFor(0, 12)).toBe(0);
  });

  test("a zero-yield item does not divide by zero", () => {
    expect(Number.isFinite(batchesFor(5_000, 0))).toBe(true);
  });
});
