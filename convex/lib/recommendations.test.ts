// @vitest-environment node
import { describe, expect, test } from "vitest";
import { periodCauses, periodPnl, rankLeaks, type PnlInput, type PnlOrder } from "./pnl";
import {
  MIN_TREND_POINTS,
  rankRecommendations,
  shouldResurface,
  type Dismissal,
  type RecommendationInput,
  type StructuralFacts,
  type Trend,
} from "./recommendations";

/**
 * The ranking she acts on.
 *
 * A recommendation is an instruction to spend an afternoon, so the arithmetic
 * behind it is checked against hand figures rather than against itself. The
 * two assertions this file exists for are the ones no type can make: that a
 * subject's dollars are never counted twice, and that this screen and Home are
 * quoting the same money.
 */

/** Brownies: $3.00 each, costing 15c + 20c + 71c = $1.06 the unit. */
const BROWNIE = {
  menuItemId: "brownie",
  description: "Brownies",
  unitPriceCents: 300,
  cogsSnapshot: { ingredientsCents: 15, perUnitExtrasCents: 20, overheadCents: 71 },
};

function anOrder(over: Partial<PnlOrder> = {}): PnlOrder {
  return {
    id: "o1",
    deliveryDate: "2026-08-04",
    customerId: "c1",
    customerName: "Tariro Moyo",
    discountCents: 0,
    deliveryFeeCents: 0,
    deliveryCostCents: 0,
    taxRateBpAtCreation: 0,
    taxInclusiveAtCreation: false,
    lines: [{ ...BROWNIE, qtyMilli: 10_000 }],
    ...over,
  };
}

function pnlInput(over: Partial<PnlInput> = {}): PnlInput {
  return {
    orders: [anOrder()],
    waste: [],
    drift: [],
    targetNetMarginPercent: 35,
    ...over,
  };
}

/** The period half of the engine's input, from the same atoms Home groups. */
function period(over: Partial<PnlInput> = {}) {
  const input = pnlInput(over);
  return periodCauses(periodPnl(input), input);
}

function facts(over: Partial<StructuralFacts> = {}): StructuralFacts {
  return { menuItemId: "brownie", name: "Brownies", ...over };
}

function run(over: Partial<RecommendationInput> = {}) {
  return rankRecommendations({
    base: "/k",
    period: [],
    structural: [],
    trends: {},
    dismissals: [],
    ...over,
  });
}

describe("one card per subject", () => {
  test("waste, underpricing and staleness on one item are ONE row", () => {
    const { live } = run({
      period: period({
        waste: [
          {
            menuItemId: "brownie",
            name: "Brownies",
            day: "2026-08-02",
            qtyMilli: 5_000,
            valueCents: 530,
          },
        ],
      }),
      structural: [
        facts({
          underpriced: {
            priceNowCents: 300,
            priceToReachTargetCents: 340,
            targetPercent: 65,
            grossMarginNowPercent: 58,
            unitsMilli: 10_000,
            verdictHeadline: null,
          },
          stalePrice: { priceSetDay: "2026-04-04", days: 123 },
        }),
      ],
    });

    const brownie = live.filter((r) => r.subjectKey === "item:brownie");
    expect(brownie).toHaveLength(1);
    // 40c a unit × 10 units = $4.00, plus $5.30 of waste. Staleness adds none.
    expect(brownie[0].cents).toBe(530 + 400);
    expect(brownie[0].causes.map((c) => c.kind)).toEqual([
      "waste",
      "underpriced",
      "stalePrice",
    ]);
  });

  test("ACCEPTANCE: the bar chart sums to the list", () => {
    const result = run({
      period: period({
        orders: [anOrder({ discountCents: 500, deliveryFeeCents: 200, deliveryCostCents: 900 })],
        waste: [
          {
            menuItemId: "cupcake",
            name: "Cupcakes",
            day: "2026-08-02",
            qtyMilli: 3_000,
            valueCents: 900,
          },
        ],
        drift: [{ ingredientId: "butter", name: "Butter", excessCents: 410 }],
      }),
      structural: [
        facts({
          underpriced: {
            priceNowCents: 300,
            priceToReachTargetCents: 340,
            targetPercent: 65,
            grossMarginNowPercent: 58,
            unitsMilli: 10_000,
            verdictHeadline: null,
          },
        }),
      ],
    });

    // Every dollar appears in exactly one row: the sum of the bars is the sum
    // of the causes, with nothing double-counted and nothing dropped.
    const barTotal = result.live.reduce((a, r) => a + r.cents, 0);
    const causeTotal = result.live
      .flatMap((r) => r.causes)
      .reduce((a, c) => a + c.cents, 0);
    expect(barTotal).toBe(causeTotal);
    // And no subject appears twice.
    const keys = result.live.map((r) => r.subjectKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("a batch-size observation never stands alone", () => {
    // Nothing was wasted, so the shape of the batch is not costing her
    // anything and is not worth an afternoon.
    const alone = run({ structural: [facts({ batch: { baseBatchYield: 5, typicalOrderUnits: 3 } })] });
    expect(alone.live).toHaveLength(0);
    expect(alone.stale).toHaveLength(0);

    // With waste against the same item it rides along as the explanation.
    const withWaste = run({
      period: period({
        waste: [
          {
            menuItemId: "brownie",
            name: "Brownies",
            day: "2026-08-02",
            qtyMilli: 2_000,
            valueCents: 212,
          },
        ],
      }),
      structural: [facts({ batch: { baseBatchYield: 5, typicalOrderUnits: 3 } })],
    });
    expect(withWaste.live[0].cents).toBe(212);
    expect(withWaste.live[0].causes.map((c) => c.kind)).toEqual(["waste", "batchSize"]);
    expect(withWaste.live[0].causes[1].sentence).toContain("A batch makes 5");
  });
});

describe("one source", () => {
  test("ACCEPTANCE: every leak Home shows is the same money this screen ranks", () => {
    const input = pnlInput({
      orders: [
        anOrder({ discountCents: 500, deliveryFeeCents: 200, deliveryCostCents: 900 }),
        anOrder({ id: "o2", deliveryDate: "2026-08-05" }),
      ],
      waste: [
        {
          menuItemId: "cupcake",
          name: "Cupcakes",
          day: "2026-08-02",
          qtyMilli: 3_000,
          valueCents: 900,
        },
      ],
      drift: [{ ingredientId: "butter", name: "Butter", excessCents: 410 }],
    });
    const pnl = periodPnl(input);
    const leaks = rankLeaks(pnl, input, "/k");
    const causes = periodCauses(pnl, input);

    // Home groups the causes by KIND; this screen groups them by SUBJECT.
    // Same atoms, so the totals agree kind by kind — the regression that
    // proves the two screens cannot disagree about a month.
    for (const leak of leaks) {
      const fromCauses = causes
        .filter((c) => c.kind === leak.kind)
        .reduce((a, c) => a + c.cents, 0);
      expect(fromCauses).toBe(leak.cents);
    }
    expect(causes.reduce((a, c) => a + c.cents, 0)).toBe(
      leaks.reduce((a, l) => a + l.cents, 0),
    );
  });

  test("period rows carry a periodCents Home can add up; structural ones do not", () => {
    const { live } = run({
      period: period({
        waste: [
          {
            menuItemId: "brownie",
            name: "Brownies",
            day: "2026-08-02",
            qtyMilli: 5_000,
            valueCents: 530,
          },
        ],
      }),
      structural: [
        facts({
          underpriced: {
            priceNowCents: 300,
            priceToReachTargetCents: 340,
            targetPercent: 65,
            grossMarginNowPercent: 58,
            unitsMilli: 10_000,
            verdictHeadline: null,
          },
        }),
        facts({
          menuItemId: "scone",
          name: "Scones",
          dormant: {
            lastOrderedDay: "2026-05-30",
            quietDays: 74,
            windowDays: 60,
            priorRevenueCents: 4_100,
          },
        }),
      ],
    });

    const brownie = live.find((r) => r.subjectKey === "item:brownie")!;
    expect(brownie.horizon).toBe("period");
    // Home may only claim the waste: the $4.00 was never lost, it was never
    // earned, and it is not in the period P&L.
    expect(brownie.periodCents).toBe(530);
    expect(brownie.cents).toBe(930);

    const scone = live.find((r) => r.subjectKey === "item:scone")!;
    expect(scone.horizon).toBe("structural");
    expect(scone.periodCents).toBe(0);
  });

  test("structural rows state their own window; period rows have none", () => {
    const { live } = run({
      period: period({
        drift: [{ ingredientId: "butter", name: "Butter", excessCents: 410 }],
      }),
      structural: [
        facts({
          menuItemId: "scone",
          name: "Scones",
          dormant: {
            lastOrderedDay: "2026-05-30",
            quietDays: 74,
            windowDays: 60,
            priorRevenueCents: 4_100,
          },
        }),
      ],
    });
    expect(live.find((r) => r.subjectKey === "ingredient:butter")!.window).toBeNull();
    // The OBSERVED gap, not the 60-day window that detected it. She wants to
    // know how long it has actually been quiet.
    expect(live.find((r) => r.subjectKey === "item:scone")!.window).toBe(
      "No orders in 74 days",
    );
  });
});

describe("each card names its kind of dollar", () => {
  test("the label comes from the largest cause, not the first one found", () => {
    const { live } = run({
      period: period({
        waste: [
          {
            menuItemId: "brownie",
            name: "Brownies",
            day: "2026-08-02",
            qtyMilli: 1_000,
            valueCents: 106,
          },
        ],
      }),
      structural: [
        facts({
          underpriced: {
            priceNowCents: 300,
            priceToReachTargetCents: 400,
            targetPercent: 75,
            grossMarginNowPercent: 58,
            unitsMilli: 10_000,
            verdictHeadline: null,
          },
        }),
      ],
    });
    // $10.00 of underpricing against $1.06 of waste.
    expect(live[0].kindLabel).toBe("below what you aimed at");
    expect(live[0].action.kind).toBe("optimise");
  });

  test("dormant reports what it earned, never what it would have earned", () => {
    const { live } = run({
      structural: [
        facts({
          menuItemId: "scone",
          name: "Scones",
          dormant: {
            lastOrderedDay: "2026-05-30",
            quietDays: 74,
            windowDays: 60,
            priorRevenueCents: 4_100,
          },
        }),
      ],
    });
    expect(live[0].cents).toBe(4_100);
    expect(live[0].kindLabel).toBe("stopped coming in");
    expect(live[0].causes[0].workings).toContain("$41.00 in the 60 days before that");
    expect(live[0].causes[0].workings).toContain("not what it would have earned");
  });

  test("the drift card's one tap is a re-cost of the ingredient", () => {
    const { live } = run({
      period: period({ drift: [{ ingredientId: "butter", name: "Butter", excessCents: 410 }] }),
    });
    expect(live[0].action).toEqual({
      kind: "adoptMedian",
      label: "Re-cost it",
      href: "/k/pantry/butter",
      targetId: "butter",
    });
  });
});

describe("staleness stays silent until it has truth", () => {
  test("an item whose price was never timestamped produces nothing", () => {
    // priceSetAt is absent on every item that predates the field, so no
    // stalePrice fact is built for it. Quiet for up to 90 days, never wrong.
    const result = run({ structural: [facts()] });
    expect(result.live).toHaveLength(0);
    expect(result.stale).toHaveLength(0);
  });

  test("standing alone it leaves the ranking entirely rather than being given a figure", () => {
    const result = run({
      structural: [facts({ stalePrice: { priceSetDay: "2026-04-04", days: 123 } })],
    });
    expect(result.live).toHaveLength(0);
    expect(result.stale).toEqual([
      { menuItemId: "brownie", name: "Brownies", days: 123, href: "/k/menu/brownie" },
    ]);
  });

  test("attached to a flagged item it is evidence, not a second row", () => {
    const result = run({
      period: period({
        waste: [
          {
            menuItemId: "brownie",
            name: "Brownies",
            day: "2026-08-02",
            qtyMilli: 1_000,
            valueCents: 106,
          },
        ],
      }),
      structural: [facts({ stalePrice: { priceSetDay: "2026-04-04", days: 123 } })],
    });
    expect(result.stale).toHaveLength(0);
    expect(result.live).toHaveLength(1);
    expect(result.live[0].causes.at(-1)!.kind).toBe("stalePrice");
    expect(result.live[0].cents).toBe(106);
  });
});

describe("dismissal remembers the figure, not a flag", () => {
  const dismissal = (over: Partial<Dismissal> = {}): Dismissal => ({
    subjectKey: "item:scone",
    dismissedAt: 1_000,
    dismissedAtCents: 4_100,
    causeKinds: ["dormant"],
    ...over,
  });

  test("ACCEPTANCE: quiet on a small move, back on a real one", () => {
    expect(shouldResurface(dismissal(), 4_400, ["dormant"])).toBe(false); // +7%
    expect(shouldResurface(dismissal(), 5_800, ["dormant"])).toBe(true); // +41%
    // Downwards too: a problem that shrank by half is news, and she should
    // not have to guess whether her fix worked.
    expect(shouldResurface(dismissal(), 2_000, ["dormant"])).toBe(true);
  });

  test("ACCEPTANCE: a new cause brings it back with the money unchanged", () => {
    expect(shouldResurface(dismissal(), 4_100, ["dormant", "waste"])).toBe(true);
    // She dismissed the problem she was SHOWN. Losing a cause is not new news.
    expect(
      shouldResurface(dismissal({ causeKinds: ["dormant", "waste"] }), 4_100, ["dormant"]),
    ).toBe(false);
  });

  test("money appearing where there was none is always material", () => {
    expect(shouldResurface(dismissal({ dismissedAtCents: 0 }), 100, ["dormant"])).toBe(true);
    expect(shouldResurface(dismissal({ dismissedAtCents: 0 }), 0, ["dormant"])).toBe(false);
  });

  test("a dismissed row leaves the ranking but is kept so she can pick it up", () => {
    const result = run({
      structural: [
        facts({
          menuItemId: "scone",
          name: "Scones",
          dormant: {
            lastOrderedDay: "2026-05-30",
            quietDays: 74,
            windowDays: 60,
            priorRevenueCents: 4_100,
          },
        }),
      ],
      dismissals: [dismissal()],
    });
    expect(result.live).toHaveLength(0);
    expect(result.dismissed.map((r) => r.subjectKey)).toEqual(["item:scone"]);
    expect(result.dismissed[0].cents).toBe(4_100);
  });
});

describe("charts only where they argue something", () => {
  const points = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, "0")}`,
      value: 100 + i,
    }));

  const withTrend = (n: number) => {
    const trend: Trend = { label: "What you paid", points: points(n) };
    return run({
      period: period({ drift: [{ ingredientId: "butter", name: "Butter", excessCents: 410 }] }),
      trends: { "ingredient:butter": trend },
    }).live[0];
  };

  test("a trend below the floor is suppressed, not drawn through", () => {
    expect(withTrend(MIN_TREND_POINTS - 1).trend).toBeNull();
    expect(withTrend(MIN_TREND_POINTS).trend).not.toBeNull();
  });

  test("a card whose argument is a single number carries no chart", () => {
    const { live } = run({
      period: period({
        orders: [anOrder({ deliveryFeeCents: 200, deliveryCostCents: 900 })],
      }),
    });
    expect(live.find((r) => r.causes[0].kind === "delivery")!.trend).toBeNull();
  });
});

describe("ranked by dollar impact, never by recency or type", () => {
  test("the order is the money, and ties break the same way every time", () => {
    const { live } = run({
      period: period({
        orders: [anOrder({ deliveryFeeCents: 0, deliveryCostCents: 300 })],
        waste: [
          {
            menuItemId: "cupcake",
            name: "Cupcakes",
            day: "2026-08-02",
            qtyMilli: 3_000,
            valueCents: 900,
          },
        ],
        drift: [{ ingredientId: "butter", name: "Butter", excessCents: 600 }],
      }),
    });
    expect(live.map((r) => r.cents)).toEqual([900, 600, 300]);
    expect(live.map((r) => r.subjectKey)).toEqual([
      "item:cupcake",
      "ingredient:butter",
      // Rule 5: the order itself is not a subject — it has shipped, and no
      // button reprices it.
      "orders:delivery",
    ]);
  });

  test("ACCEPTANCE: order-scoped causes collapse to one row per kind, money intact", () => {
    const causes = period({
      orders: [
        anOrder({ id: "o1", deliveryFeeCents: 0, deliveryCostCents: 300 }),
        anOrder({ id: "o2", deliveryFeeCents: 0, deliveryCostCents: 900 }),
        anOrder({ id: "o3", deliveryFeeCents: 100, deliveryCostCents: 250 }),
      ],
    });
    const perOrder = causes
      .filter((c) => c.kind === "delivery")
      .reduce((a, c) => a + c.cents, 0);

    const { live } = run({ period: causes });
    const row = live.find((r) => r.subjectKey === "orders:delivery")!;
    // Three orders in, one row out, and not a cent lost on the way — which is
    // what keeps this screen and Home quoting the same month.
    expect(live.filter((r) => r.causes.some((c) => c.kind === "delivery"))).toHaveLength(1);
    expect(row.cents).toBe(perOrder);
    expect(row.action.label).toBe("Change the delivery fee");
    // The individual orders survive as evidence, worst first.
    expect(row.causes[0].workings).toContain("Worst first:");
    expect(row.causes[0].workings).toContain("$9.00");
  });

  test("nothing wrong is an empty ranking, not a ranking of zeroes", () => {
    const result = run({ period: period() });
    expect(result.live).toHaveLength(0);
    expect(result.dismissed).toHaveLength(0);
    expect(result.stale).toHaveLength(0);
  });
});
