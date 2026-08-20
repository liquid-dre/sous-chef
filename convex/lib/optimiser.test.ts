// @vitest-environment node
import { describe, expect, test } from "vitest";
import { costItem, type CostingItem, type CostingWorld, type Costing } from "./costing";
import { leversFrom, optimise, type OptimiserConstraints } from "./optimiser";

/**
 * The worked case, typed in exactly as she stated it: $5.40 of ingredients a
 * tray, a 42c box on every brownie, $2.00 each, 65% wanted, cut into 12.
 *
 * Solving her three data points (52% at 10, 57% at 12, 61% at 15) gives
 * L1 = 540 and L2 = 42, and every figure below follows from those two.
 */
function costingOf(over: Partial<Costing> & { l1: number; l2: number; l3?: number }): Costing {
  const { l1, l2, l3 = 0, ...rest } = over;
  const yieldUnits = rest.yieldUnits ?? 12;
  const layer = (perBatch: number) => ({
    centsPerBatch: perBatch,
    centsPerUnit: perBatch / yieldUnits,
    lines: [],
  });
  const variable = l1 / yieldUnits + l2;
  const total = variable + l3 / yieldUnits;
  return {
    itemId: "brownies",
    yieldUnits,
    unitWeightMilligrams: 85_000,
    ingredients: layer(l1),
    // NOTE: centsPerBatch here is l2 × yield, mirroring the real engine —
    // the optimiser must ignore it and read centsPerUnit.
    extras: { centsPerBatch: l2 * yieldUnits, centsPerUnit: l2, lines: [] },
    overhead: { ...layer(l3), minutesPerBatch: 0 },
    variableCentsPerUnit: variable,
    variableCentsPerBatch: variable * yieldUnits,
    totalCentsPerUnit: total,
    totalCentsPerBatch: total * yieldUnits,
    priceCents: 200,
    grossMarginPercent: null,
    netMarginPercent: null,
    targetGrossMarginPercent: 65,
    belowTarget: false,
    ...rest,
  };
}

const NO_FENCES: OptimiserConstraints = {
  minPriceCents: null,
  maxPriceCents: null,
  minYield: null,
  maxYield: null,
  unitWeightFloorMilligrams: null,
  constraintNote: null,
};

const fences = (over: Partial<OptimiserConstraints>): OptimiserConstraints => ({
  ...NO_FENCES,
  constraintNote: "Church stall won't pay more than $4.",
  ...over,
});

/** The acceptance world: L1 540, L2 42, price $2.00, target 65%, cut into 12. */
const run = (
  constraints: OptimiserConstraints = NO_FENCES,
  over: Partial<Costing> & { l1?: number; l2?: number; l3?: number } = {},
) =>
  optimise({
    costing: costingOf({ l1: 540, l2: 42, ...over }),
    constraints,
  });

const at = (o: ReturnType<typeof run>, n: number) =>
  o.options.find((row) => row.yieldUnits === n);

describe("levers", () => {
  test("reads layer 2 per unit, never the yield-scaled per-batch figure", () => {
    const levers = leversFrom(costingOf({ l1: 540, l2: 42, yieldUnits: 12 }));
    expect(levers.layer1CentsPerBatch).toBe(540);
    // 42, not 504 (= 42 × 12). Reading centsPerBatch here would make
    // packaging scale with yield and destroy the asymptote entirely.
    expect(levers.layer2CentsPerUnit).toBe(42);
  });
});

describe("ACCEPTANCE: $5.40 a tray, a 42c box, $2.00 a brownie, 65% wanted", () => {
  test("52% at 10 a tray", () => {
    // 540/10 + 42 = 96c variable; (200 − 96)/200 = 52%.
    const row = at(run(), 10)!;
    expect(row.variableCentsPerUnit).toBeCloseTo(96, 6);
    expect(row.grossMarginPercent).toBe(52);
  });

  test("57% at 12 a tray, exactly 56.5 underneath", () => {
    const row = at(run(), 12)!;
    expect(row.variableCentsPerUnit).toBeCloseTo(87, 6);
    expect(row.grossMarginPercent).toBe(57);
    expect(row.grossMarginExact).toBeCloseTo(56.5, 6);
  });

  test("61% at 15 a tray", () => {
    // 540/15 + 42 = 78c.
    const row = at(run({ ...NO_FENCES }), 15) ?? at(run(), 15);
    expect(row!.variableCentsPerUnit).toBeCloseTo(78, 6);
    expect(row!.grossMarginPercent).toBe(61);
  });

  test("65% first arrives at 20 a tray", () => {
    const o = run();
    expect(o.verdict.targetYield).toBe(20);
    expect(o.verdict.kind).toBe("reachable");
    expect(o.verdict.bindingConstraint).toBeNull();
  });

  test("the ceiling at $2.00 is 79%", () => {
    // (200 − 42)/200 = 79%. Every yield sits below it, forever.
    const o = run();
    expect(o.ceilingPercentExact).toBeCloseTo(79, 6);
    expect(o.verdict.ceilingPercent).toBe(79);
    for (const row of o.options) {
      expect(row.grossMarginExact!).toBeLessThan(79);
    }
  });

  test("margins climb as the tray is cut finer, and never fall", () => {
    const o = run();
    for (let i = 1; i < o.options.length; i += 1) {
      expect(o.options[i].grossMarginExact!).toBeGreaterThan(
        o.options[i - 1].grossMarginExact!,
      );
    }
  });

  test("65% at the current 12 would need $2.49 — rounded up, because $2.48 misses", () => {
    // 87 / 0.35 = 248.571…
    const o = run();
    expect(o.priceToReachTargetAtCurrentYieldCents).toBe(249);
    // The rounding direction matters: at 248c the margin is 64.9%, not 65%.
    expect(((248 - 87) / 248) * 100).toBeLessThan(65);
    expect(((249 - 87) / 249) * 100).toBeGreaterThanOrEqual(65);
  });

  test("the headline price is the current row's price, never a second calculation", () => {
    const o = run();
    expect(o.priceToReachTargetAtCurrentYieldCents).toBe(
      at(o, o.currentYield)!.priceToReachTargetCents,
    );
  });

  test("the tooltip price falls as the tray is cut finer", () => {
    const o = run();
    expect(at(o, 15)!.priceToReachTargetCents).toBe(223); // 78 / 0.35 = 222.86
    expect(at(o, 19)!.priceToReachTargetCents).toBe(202);
    // At 20 the required price drops BELOW her $2.00 — the same fact as
    // reaching target there, asserted together.
    expect(at(o, 20)!.priceToReachTargetCents).toBe(198);
    expect(at(o, 20)!.reachesTarget).toBe(true);
  });

  test("the window runs 9 to 20 and holds both today and the answer", () => {
    const o = run();
    expect(o.windowStartYield).toBe(9);
    expect(o.windowEndYield).toBe(20);
    expect(o.options).toHaveLength(12);
    expect(at(o, 12)!.isCurrent).toBe(true);
    expect(o.verdict.targetYieldInWindow).toBe(true);
  });

  test("the tray keeps its mass: 85 g at 12 becomes 51 g at 20", () => {
    const o = run();
    expect(at(o, 12)!.unitWeightMilligrams).toBe(85_000);
    expect(at(o, 20)!.unitWeightMilligrams).toBe(51_000); // 85 × 12/20
  });

  test("ACCEPTANCE: with a weight floor, 65% is not reachable by yield alone", () => {
    // Her spec's case. 51 g at yield 20 is under a 60 g floor, so the answer
    // exists arithmetically but her own limit stands in front of it.
    const o = run(fences({ unitWeightFloorMilligrams: 60_000 }));
    expect(o.verdict.targetYield).toBe(20);
    expect(o.verdict.kind).toBe("blocked");
    expect(o.verdict.bindingConstraint).toBe("unitWeightFloor");
    expect(o.verdict.relaxingBindingAloneReachesTarget).toBe(true);
  });
});

describe("the off-by-one guard", () => {
  test("19 a tray DISPLAYS 65% and does not reach 65%", () => {
    // 540/19 + 42 = 70.42c → 64.79%, which rounds to 65. Comparing the
    // rounded percent would move the answer a whole yield step.
    const row = at(run(), 19)!;
    expect(row.grossMarginPercent).toBe(65);
    expect(row.grossMarginExact).toBeCloseTo(64.7895, 3);
    expect(row.reachesTarget).toBe(false);
    // And the tooltip explains it in her terms: $2.02, not her $2.00.
    expect(row.priceToReachTargetCents).toBe(202);
  });
});

describe("tier 1 — the asymptote", () => {
  test("85% names the ceiling and the box, and names no fence", () => {
    const o = run(fences({ unitWeightFloorMilligrams: 60_000 }), {
      targetGrossMarginPercent: 85,
    });
    expect(o.verdict.kind).toBe("asymptote");
    expect(o.verdict.ceilingPercent).toBe(79);
    expect(o.verdict.layer2CentsPerUnit).toBe(42);
    expect(o.verdict.targetYield).toBeNull();
    // No fence change helps, so naming one would send her on a false errand.
    expect(o.verdict.bindingConstraint).toBeNull();
    expect(o.verdict.detail).toContain("$0.42");
    expect(o.verdict.detail).toContain("79%");
  });

  test("no yield in the ladder reaches an out-of-reach target", () => {
    const o = run(NO_FENCES, { targetGrossMarginPercent: 85 });
    expect(o.options.every((r) => !r.reachesTarget)).toBe(true);
  });

  test("a target EXACTLY on the ceiling is still out of reach", () => {
    // 79% needs L1/N = 0, i.e. an infinite yield. A strict > here would
    // compute ceil(540/0) = Infinity and hang the search.
    const o = run(NO_FENCES, { targetGrossMarginPercent: 79 });
    expect(o.verdict.kind).toBe("asymptote");
    expect(o.verdict.targetYield).toBeNull();
  });

  test("with no ingredients, a target on the ceiling is met at every yield", () => {
    // L1 = 0 means variable cost is 42c at every yield: the ceiling is not a
    // limit approached, it is where she already is.
    const o = run(NO_FENCES, { l1: 0, targetGrossMarginPercent: 79 });
    expect(o.verdict.kind).not.toBe("asymptote");
    expect(o.options.every((r) => r.reachesTarget)).toBe(true);
  });

  test("packaging dearer than the price gives a negative ceiling, not a NaN", () => {
    const o = run(NO_FENCES, { l2: 250 });
    expect(o.ceilingPercentExact).toBeCloseTo(-25, 6);
    expect(o.verdict.kind).toBe("asymptote");
    expect(Number.isNaN(o.ceilingPercentExact!)).toBe(false);
    expect(o.options.every((r) => r.grossMarginExact! < 0)).toBe(true);
  });
});

describe("tier 2 — fences, and the clause that stops whack-a-mole", () => {
  test("a weight floor binds, and moving it alone would be enough", () => {
    const o = run(fences({ unitWeightFloorMilligrams: 60_000 }));
    expect(o.verdict.bindingConstraint).toBe("unitWeightFloor");
    // 85 × 12/n < 60 first at n = 18 (56.67 g).
    expect(o.verdict.bindingConstraintOnsetYield).toBe(18);
    expect(o.verdict.relaxingBindingAloneReachesTarget).toBe(true);
    expect(o.verdict.detail).toContain("Moving that one limit would be enough");
  });

  test("add a yield cap and moving the binding fence alone stops being enough", () => {
    const o = run(
      fences({ unitWeightFloorMilligrams: 60_000, maxYield: 16 }),
    );
    // maxYield bites at 17, before the floor's 18, so it binds.
    expect(o.verdict.bindingConstraint).toBe("maxYield");
    expect(o.verdict.bindingConstraintOnsetYield).toBe(17);
    // Lifting the cap still leaves the floor. This is the whole clause.
    expect(o.verdict.relaxingBindingAloneReachesTarget).toBe(false);
    expect(o.verdict.detail).toContain("another one stands behind it");
  });

  test("blocked yields are shown and marked, never removed", () => {
    const o = run(fences({ unitWeightFloorMilligrams: 60_000 }));
    const blocked = at(o, 18);
    expect(blocked).toBeDefined();
    expect(blocked!.blocked).toBe(true);
    expect(blocked!.blocks[0].kind).toBe("unitWeightFloor");
    expect(blocked!.blocks[0].reason).toContain("56.7 g");
  });

  test("every block carries her own reason for the fence", () => {
    const o = run(fences({ unitWeightFloorMilligrams: 60_000 }));
    const blocked = at(o, 18)!;
    expect(blocked.blocks[0].note).toBe("Church stall won't pay more than $4.");
  });

  test("the window stops one past the first block, so the block is visible", () => {
    const o = run(fences({ unitWeightFloorMilligrams: 60_000 }));
    expect(o.windowEndYield).toBe(19);
    expect(o.verdict.targetYieldInWindow).toBe(false);
    // The answer is still named even though it is off the chart.
    expect(o.verdict.targetYield).toBe(20);
  });

  test("a minimum yield does not truncate the ladder, and does not bind the answer", () => {
    // minYield blocks a DOWNWARD region. Capping the top of the ladder at it
    // would collapse the chart to nothing.
    const o = run(fences({ minYield: 15 }));
    expect(o.windowEndYield).toBe(20);
    expect(at(o, 9)!.blocked).toBe(true);
    expect(at(o, 20)!.blocked).toBe(false);
    // It blocks 9–14, but it is not why she cannot reach 20.
    expect(o.verdict.bindingConstraint).toBeNull();
    expect(o.verdict.kind).toBe("reachable");
  });

  test("a price ceiling blocks the current yield but not the yield that reaches target", () => {
    const o = run(fences({ maxPriceCents: 210 }));
    // $2.49 at 12 is above her $2.10 ceiling.
    expect(
      o.priceToReachTargetAtCurrentYieldBlocks.some((b) => b.kind === "maxPrice"),
    ).toBe(true);
    // $1.98 at 20 is not.
    expect(at(o, 20)!.blocked).toBe(false);
  });

  test("a price floor annotates, it never strikes", () => {
    // 65% at 20 needs $1.98, under her $2.50 floor — but charging $2.50 would
    // CLEAR target, not miss it. Striking it would assert something false.
    const o = run(fences({ minPriceCents: 250 }));
    const row = at(o, 20)!;
    const block = row.blocks.find((b) => b.kind === "minPrice");
    expect(block).toBeDefined();
    expect(block!.severity).toBe("advisory");
    expect(row.blocked).toBe(false);
  });

  test("contradictory limits are reported, not quietly reconciled", () => {
    const o = run(fences({ minYield: 20, maxYield: 15 }));
    expect(o.contradictoryConstraints).toBe(true);
    expect(o.verdict.bindingConstraint).not.toBeNull();
  });
});

describe("degenerate inputs", () => {
  test("no price: margins are absent, target prices are not", () => {
    const o = run(NO_FENCES, { priceCents: null });
    expect(o.verdict.kind).toBe("noPrice");
    expect(at(o, 12)!.grossMarginPercent).toBeNull();
    expect(at(o, 12)!.priceToReachTargetCents).toBe(249);
    expect(o.ceilingPercentExact).toBeNull();
  });

  test("no target: margins are there, target prices are not", () => {
    const o = run(NO_FENCES, { targetGrossMarginPercent: null });
    expect(o.verdict.kind).toBe("noTarget");
    expect(at(o, 12)!.grossMarginPercent).toBe(57);
    expect(at(o, 12)!.priceToReachTargetCents).toBeNull();
    expect(o.verdict.targetYield).toBeNull();
  });

  test("a zero or negative price is treated as no price", () => {
    expect(run(NO_FENCES, { priceCents: 0 }).verdict.kind).toBe("noPrice");
    expect(run(NO_FENCES, { priceCents: -100 }).verdict.kind).toBe("noPrice");
  });

  test("a target of 0 is legal; 100 and −5 are not", () => {
    const zero = run(NO_FENCES, { targetGrossMarginPercent: 0 });
    expect(zero.priceToReachTargetAtCurrentYieldCents).toBe(87);
    expect(run(NO_FENCES, { targetGrossMarginPercent: 100 }).verdict.kind).toBe(
      "impossibleTarget",
    );
    expect(run(NO_FENCES, { targetGrossMarginPercent: -5 }).verdict.kind).toBe(
      "impossibleTarget",
    );
  });

  test("an empty item says so, and never quotes a $0.00 price", () => {
    const o = run(NO_FENCES, { l1: 0, l2: 0, l3: 0 });
    expect(o.verdict.kind).toBe("noCost");
    expect(o.priceToReachTargetAtCurrentYieldCents).toBeNull();
  });

  test("a yield of 1 does not produce a zeroth row", () => {
    const o = run(NO_FENCES, { yieldUnits: 1 });
    expect(o.windowStartYield).toBe(1);
    expect(o.options.every((r) => r.yieldUnits >= 1)).toBe(true);
    expect(o.options.every((r) => Number.isFinite(r.variableCentsPerUnit))).toBe(true);
  });

  test("already at target says so rather than inventing advice", () => {
    const o = run(NO_FENCES, { priceCents: 400 });
    expect(o.verdict.kind).toBe("alreadyAtTarget");
    expect(o.priceToReachTargetAtCurrentYieldCents!).toBeLessThanOrEqual(400);
  });

  test("an exact answer does not gain a phantom cent", () => {
    // v = 70, t = 65 → 70/0.35 = 200.00000000000003 in IEEE754. Charging
    // $2.01 for a $2.00 answer would be a lie by one cent, every time.
    const o = optimise({
      costing: costingOf({ l1: 0, l2: 70, yieldUnits: 12, priceCents: 200 }),
      constraints: NO_FENCES,
    });
    expect(o.priceToReachTargetAtCurrentYieldCents).toBe(200);
  });

  test("fractional-cent levers still yield whole-cent prices", () => {
    // 500 g of flour at $1.85/kg is 92.5c — the levers are not integers.
    const o = run(NO_FENCES, { l1: 176.5 });
    for (const row of o.options) {
      expect(Number.isInteger(row.priceToReachTargetCents!)).toBe(true);
    }
  });
});

describe("round-trip against the cost engine", () => {
  /** The nested brownie from costing.test.ts, so the optimiser is fed a real
   * Costing rather than a literal — the test that catches anyone reading
   * extras.centsPerBatch. */
  const WORLD: CostingWorld = {
    ingredients: {
      butter: { id: "butter", name: "Butter", baseUnit: "g", standardCostCentsPerThousand: 420 },
      flour: { id: "flour", name: "Flour", baseUnit: "g", standardCostCentsPerThousand: 185 },
    },
    overheadRateCentsPerHour: 800,
    items: {
      buttercream: {
        id: "buttercream",
        name: "Buttercream",
        notSoldDirectly: true,
        baseBatchYield: 10,
        unitWeightMilligrams: 100_000,
        batchProductionMinutes: 20,
        perUnitExtras: [],
        lines: [{ componentType: "ingredient", componentId: "butter", qtyMilli: 1_000_000 }],
      } as CostingItem,
      brownies: {
        id: "brownies",
        name: "Brownies",
        notSoldDirectly: false,
        baseBatchYield: 12,
        unitWeightMilligrams: 85_000,
        batchProductionMinutes: 60,
        perUnitExtras: [{ label: "Box", costCents: 20 }],
        priceCents: 300,
        targetGrossMarginPercent: 65,
        lines: [
          { componentType: "menuItem", componentId: "buttercream", qtyMilli: 2_000 },
          { componentType: "ingredient", componentId: "flour", qtyMilli: 500_000 },
        ],
      } as CostingItem,
    },
  };

  test("the current row agrees with the costing it came from, field for field", () => {
    const costing = costItem("brownies", WORLD);
    const o = optimise({ costing, constraints: NO_FENCES });
    const row = at(o, costing.yieldUnits)!;
    expect(row.variableCentsPerUnit).toBeCloseTo(costing.variableCentsPerUnit, 6);
    expect(row.totalCentsPerUnit).toBeCloseTo(costing.totalCentsPerUnit, 6);
    expect(row.grossMarginPercent).toBe(costing.grossMarginPercent);
    expect(row.netMarginPercent).toBe(costing.netMarginPercent);
  });

  test("doubling the yield halves layers 1 and 3 per unit and leaves the box alone", () => {
    const costing = costItem("brownies", WORLD);
    const o = optimise({ costing, constraints: NO_FENCES });
    const twelve = at(o, 12)!;
    // The window reaches 24 only if target allows; compute directly instead.
    const levers = leversFrom(costing);
    expect(twelve.ingredientsCentsPerUnit).toBeCloseTo(levers.layer1CentsPerBatch / 12, 6);
    expect(levers.layer1CentsPerBatch / 24).toBeCloseTo(twelve.ingredientsCentsPerUnit / 2, 6);
    expect(levers.layer3CentsPerBatch / 24).toBeCloseTo(twelve.overheadCentsPerUnit / 2, 6);
    // Layer 2 does not move. This is the asymptote in one line.
    expect(levers.layer2CentsPerUnit).toBe(20);
  });
});
