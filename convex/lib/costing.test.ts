// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  costItem,
  findCycle,
  itemsThatWouldLoop,
  rescaleUnitWeight,
  usedBy,
  type CostingItem,
  type CostingWorld,
} from "./costing";

/** Butter $4.20/kg, flour $1.85/kg, sugar $1.50/kg. */
const INGREDIENTS = {
  butter: { id: "butter", name: "Butter", baseUnit: "g" as const, standardCostCentsPerThousand: 420 },
  flour: { id: "flour", name: "Flour", baseUnit: "g" as const, standardCostCentsPerThousand: 185 },
  sugar: { id: "sugar", name: "Sugar", baseUnit: "g" as const, standardCostCentsPerThousand: 150 },
};

function item(over: Partial<CostingItem> & { id: string; name: string }): CostingItem {
  return {
    notSoldDirectly: false,
    baseBatchYield: 1,
    unitWeightMilligrams: 100_000,
    batchProductionMinutes: 0,
    perUnitExtras: [],
    lines: [],
    ...over,
  };
}

/** Brownie → Buttercream → Butter. The three-level nest. */
function nestedWorld(over: { buttercreamExtras?: { label: string; costCents: number }[] } = {}): CostingWorld {
  const buttercream = item({
    id: "buttercream",
    name: "Buttercream",
    notSoldDirectly: true,
    baseBatchYield: 10,
    unitWeightMilligrams: 100_000, // 100 g per unit
    batchProductionMinutes: 20,
    perUnitExtras: over.buttercreamExtras ?? [],
    // 1 kg of butter per batch
    lines: [{ componentType: "ingredient", componentId: "butter", qtyMilli: 1_000_000 }],
  });
  const brownie = item({
    id: "brownie",
    name: "Brownie",
    baseBatchYield: 12,
    unitWeightMilligrams: 85_000, // 85 g each
    batchProductionMinutes: 60,
    priceCents: 300,
    targetGrossMarginPercent: 65,
    perUnitExtras: [{ label: "Box", costCents: 20 }],
    lines: [
      { componentType: "menuItem", componentId: "buttercream", qtyMilli: 2_000 }, // 2 units
      { componentType: "ingredient", componentId: "flour", qtyMilli: 500_000 }, // 500 g
    ],
  });
  return {
    items: { buttercream, brownie },
    ingredients: INGREDIENTS,
    overheadRateCentsPerHour: 800, // $8.00/hour
  };
}

describe("ACCEPTANCE: a three-level nest costs correctly", () => {
  const world = nestedWorld();

  test("butter reaches the brownie through buttercream", () => {
    // Buttercream: 1 kg butter = 420c per batch of 10 → 42c per unit.
    const bc = costItem("buttercream", world);
    expect(bc.ingredients.centsPerBatch).toBeCloseTo(420, 6);
    expect(bc.variableCentsPerUnit).toBeCloseTo(42, 6);

    // Brownie layer 1 = buttercream (42c × 2 units) + flour (92.5c).
    const brownie = costItem("brownie", world);
    expect(brownie.ingredients.centsPerBatch).toBeCloseTo(84 + 92.5, 6);
    expect(brownie.ingredients.centsPerUnit).toBeCloseTo(176.5 / 12, 6);
  });

  test("the sub-recipe enters as ONE line that carries its own composition", () => {
    const brownie = costItem("brownie", world);
    const sub = brownie.ingredients.lines.find((l) => l.kind === "subRecipe")!;
    expect(sub.name).toBe("Buttercream");
    // Expanded in place: butter is inside it, not flattened into the brownie.
    expect(sub.children?.map((c) => c.name)).toEqual(["Butter"]);
    expect(brownie.ingredients.lines.map((l) => l.name)).toEqual([
      "Buttercream",
      "Flour",
    ]);
  });

  test("sub-recipe batch time contributes proportionally to overhead", () => {
    const brownie = costItem("brownie", world);
    // 60 min of its own + 20 min × (2 units ÷ 10 per batch) = 64.
    expect(brownie.overhead.minutesPerBatch).toBeCloseTo(64, 6);
    expect(brownie.overhead.centsPerBatch).toBeCloseTo((800 * 64) / 60, 6);
    // And the working-out separates the two so she can see why.
    expect(brownie.overhead.lines.map((l) => l.name)).toEqual([
      "This recipe",
      "Sub-recipes",
    ]);
  });

  test("all three layers, both margins, per unit and per batch", () => {
    const c = costItem("brownie", world);
    const variable = 176.5 / 12 + 20;
    expect(c.variableCentsPerUnit).toBeCloseTo(variable, 6);
    expect(c.totalCentsPerUnit).toBeCloseTo(variable + (800 * 64) / 60 / 12, 6);
    expect(c.variableCentsPerBatch).toBeCloseTo(variable * 12, 6);
    expect(c.grossMarginPercent).toBe(
      Math.round(((300 - variable) / 300) * 100),
    );
    expect(c.netMarginPercent).toBeLessThan(c.grossMarginPercent!);
  });

  test("re-pricing butter moves the brownie — the chain is live", () => {
    const dearer: CostingWorld = {
      ...world,
      ingredients: {
        ...INGREDIENTS,
        butter: { ...INGREDIENTS.butter, standardCostCentsPerThousand: 840 },
      },
    };
    const before = costItem("brownie", world).variableCentsPerUnit;
    const after = costItem("brownie", dearer).variableCentsPerUnit;
    // Butter doubling adds 42c per buttercream unit × 2 ÷ 12 brownies = 7c.
    expect(after - before).toBeCloseTo(7, 6);
  });

  test("a sub-recipe's OWN per-unit extras roll up — layer 2 is not lost", () => {
    // This is what dissolving sub-recipes into raw ingredients would drop.
    const withExtras = nestedWorld({
      buttercreamExtras: [{ label: "Piping bag", costCents: 5 }],
    });
    const plain = costItem("brownie", nestedWorld()).variableCentsPerUnit;
    const rich = costItem("brownie", withExtras).variableCentsPerUnit;
    // 5c per buttercream unit × 2 units ÷ 12 brownies.
    expect(rich - plain).toBeCloseTo((5 * 2) / 12, 6);
  });
});

describe("sub-recipes have no margin of their own", () => {
  test("no price means no margin, and that is not an error", () => {
    const c = costItem("buttercream", nestedWorld());
    expect(c.priceCents).toBeNull();
    expect(c.grossMarginPercent).toBeNull();
    expect(c.netMarginPercent).toBeNull();
    expect(c.belowTarget).toBe(false);
    // It still has a real cost.
    expect(c.variableCentsPerUnit).toBeGreaterThan(0);
  });

  test("where-used answers the question a sub-recipe actually raises", () => {
    expect(usedBy("buttercream", nestedWorld().items)).toEqual([
      { id: "brownie", name: "Brownie", unitsConsumed: 2 },
    ]);
  });
});

describe("cycles", () => {
  test("ACCEPTANCE: a cycle is detected and named end to end", () => {
    const world = nestedWorld();
    world.items.buttercream.lines.push({
      componentType: "menuItem",
      componentId: "brownie",
      qtyMilli: 1_000,
    });
    expect(findCycle("brownie", world.items)).toEqual([
      "Brownie",
      "Buttercream",
      "Brownie",
    ]);
  });

  test("an item inside itself is caught", () => {
    const world = nestedWorld();
    world.items.brownie.lines.push({
      componentType: "menuItem",
      componentId: "brownie",
      qtyMilli: 1_000,
    });
    expect(findCycle("brownie", world.items)).toEqual(["Brownie", "Brownie"]);
  });

  test("a clean nest reports no cycle", () => {
    expect(findCycle("brownie", nestedWorld().items)).toBeNull();
  });

  test("the picker knows what would loop before she picks it", () => {
    const looping = itemsThatWouldLoop("buttercream", nestedWorld().items);
    // Brownie already contains buttercream, so buttercream must not take it.
    expect([...looping].sort()).toEqual(["brownie", "buttercream"]);
    // The brownie, meanwhile, may take anything except itself.
    expect([...itemsThatWouldLoop("brownie", nestedWorld().items)]).toEqual([
      "brownie",
    ]);
  });

  test("costing a cyclic graph terminates instead of hanging", () => {
    const world = nestedWorld();
    world.items.buttercream.lines.push({
      componentType: "menuItem",
      componentId: "brownie",
      qtyMilli: 1_000,
    });
    const c = costItem("brownie", world);
    expect(Number.isFinite(c.totalCentsPerUnit)).toBe(true);
  });
});

describe("yield rescales unit weight", () => {
  test("ACCEPTANCE: 10 → 15 shrinks each brownie from 85 g to ~57 g", () => {
    // Same tray, cut differently: total mass is constant.
    expect(rescaleUnitWeight(85_000, 10, 15)).toBe(56_667);
    expect(Math.round(56_667 / 1000)).toBe(57);
  });

  test("cutting fewer, larger pieces works the same way", () => {
    expect(rescaleUnitWeight(85_000, 10, 5)).toBe(170_000);
  });

  test("nonsense yields leave the weight alone rather than dividing by zero", () => {
    expect(rescaleUnitWeight(85_000, 10, 0)).toBe(85_000);
    expect(rescaleUnitWeight(85_000, 0, 15)).toBe(85_000);
  });

  test("changing yield moves cost per unit and both margins", () => {
    const world = nestedWorld();
    const at12 = costItem("brownie", world);
    world.items.brownie.baseBatchYield = 24;
    const at24 = costItem("brownie", world);
    // Twice the brownies from one tray: ingredients per unit halve...
    expect(at24.ingredients.centsPerUnit).toBeCloseTo(
      at12.ingredients.centsPerUnit / 2,
      6,
    );
    // ...overhead per unit halves too...
    expect(at24.overhead.centsPerUnit).toBeCloseTo(
      at12.overhead.centsPerUnit / 2,
      6,
    );
    // ...but the box is per unit, so layer 2 does NOT.
    expect(at24.extras.centsPerUnit).toBe(at12.extras.centsPerUnit);
    expect(at24.grossMarginPercent!).toBeGreaterThan(at12.grossMarginPercent!);
  });
});

describe("target margin", () => {
  test("belowTarget only fires when a price and a target both exist", () => {
    const world = nestedWorld();
    expect(costItem("brownie", world).belowTarget).toBe(false); // 88% vs 65%

    world.items.brownie.priceCents = 40; // barely above cost
    expect(costItem("brownie", world).belowTarget).toBe(true);

    world.items.brownie.targetGrossMarginPercent = null;
    expect(costItem("brownie", world).belowTarget).toBe(false);
  });
});
