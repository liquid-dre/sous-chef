// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  costTree,
  dailySeries,
  periodPnl,
  rankCustomers,
  rankItems,
  rankLeaks,
  rankOrders,
  sankeyFrom,
  type PnlInput,
  type PnlOrder,
} from "./pnl";

/**
 * The arithmetic behind the one sentence Sous exists to say. A margin that is
 * quietly wrong is worse than no dashboard, because she would act on it — so
 * every figure here is checked against hand arithmetic, not against itself.
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

function input(over: Partial<PnlInput> = {}): PnlInput {
  return {
    orders: [anOrder()],
    waste: [],
    drift: [],
    targetNetMarginPercent: 35,
    ...over,
  };
}

describe("the claim", () => {
  test("ten brownies: hand-checked to the cent", () => {
    const pnl = periodPnl(input());
    // 10 × $3.00
    expect(pnl.grossRevenueCents).toBe(3_000);
    expect(pnl.ingredientsCents).toBe(150);
    expect(pnl.packagingCents).toBe(200);
    expect(pnl.overheadCents).toBe(710);
    expect(pnl.totalCostCents).toBe(1_060);
    expect(pnl.profitCents).toBe(1_940);
    // 1940 / 3000 = 64.66… → 65
    expect(pnl.netMarginPercent).toBe(65);
  });

  test("a discount comes off revenue, not off cost", () => {
    const pnl = periodPnl(input({ orders: [anOrder({ discountCents: 500 })] }));
    expect(pnl.discountCents).toBe(500);
    expect(pnl.netRevenueCents).toBe(2_500);
    expect(pnl.totalCostCents).toBe(1_060);
    expect(pnl.profitCents).toBe(1_440);
    expect(pnl.netMarginPercent).toBe(58);
  });

  test("delivery: the fee is revenue in, the fuel is a cost out", () => {
    const pnl = periodPnl(
      input({ orders: [anOrder({ deliveryFeeCents: 500, deliveryCostCents: 400 })] }),
    );
    expect(pnl.grossRevenueCents).toBe(3_500);
    expect(pnl.deliveryCostCents).toBe(400);
    // Charging $5 and burning $4 must read as $1, never as $5.
    expect(pnl.profitCents).toBe(3_500 - 1_060 - 400);
  });

  test("inclusive VAT is money that was never hers", () => {
    const pnl = periodPnl(
      input({
        orders: [anOrder({ taxRateBpAtCreation: 1550, taxInclusiveAtCreation: true })],
      }),
    );
    // 3000 × 1550 / 11550 = 402.59… → 403
    expect(pnl.vatCents).toBe(403);
    expect(pnl.netRevenueCents).toBe(2_597);
    expect(pnl.profitCents).toBe(3_000 - 403 - 1_060);
  });

  test("no orders: nothing is claimed, and margin is null rather than zero", () => {
    const pnl = periodPnl(input({ orders: [] }));
    expect(pnl.grossRevenueCents).toBe(0);
    expect(pnl.profitCents).toBe(0);
    // Null, not 0%. A kitchen with no orders does not have a 0% margin — it
    // has no margin, and the screen must say something different.
    expect(pnl.netMarginPercent).toBeNull();
    expect(pnl.orderCount).toBe(0);
  });
});

describe("ACCEPTANCE: uncosted revenue never enters the claim", () => {
  const withOffMenu = input({
    orders: [
      anOrder({
        lines: [
          { ...BROWNIE, qtyMilli: 10_000 },
          // Off-menu: no cogsSnapshot, so Sous cannot cost it.
          {
            menuItemId: null,
            description: "Catering, her cousin's wedding",
            qtyMilli: 1_000,
            unitPriceCents: 7_000,
          },
        ],
      }),
    ],
  });

  test("its revenue is reported separately, not folded in", () => {
    const pnl = periodPnl(withOffMenu);
    expect(pnl.uncostedRevenueCents).toBe(7_000);
    // The claim covers ONLY what can be costed.
    expect(pnl.grossRevenueCents).toBe(3_000);
    // 7000 of 10000 total revenue.
    expect(pnl.uncostedSharePercent).toBe(70);
  });

  test("the margin is unchanged by it — the trap this rule exists to close", () => {
    const withOut = periodPnl(input());
    const withIn = periodPnl(withOffMenu);
    // Counting the $70 of revenue with none of its cost would have taken the
    // margin from 65% to 89% for doing nothing but more uncosted work.
    expect(withIn.netMarginPercent).toBe(withOut.netMarginPercent);
    expect(withIn.profitCents).toBe(withOut.profitCents);
  });

  test("a discount is shared across both halves, not dumped on the costed one", () => {
    const pnl = periodPnl({
      ...withOffMenu,
      orders: [{ ...withOffMenu.orders[0], discountCents: 1_000 }],
    });
    // Costed goods are 3000 of 10000, so 30% of the $10 discount.
    expect(pnl.discountCents).toBe(300);
  });
});

describe("ACCEPTANCE: the Sankey balances", () => {
  const busy = input({
    orders: [
      anOrder({
        id: "o1",
        discountCents: 250,
        deliveryFeeCents: 500,
        deliveryCostCents: 400,
        taxRateBpAtCreation: 1550,
        taxInclusiveAtCreation: true,
      }),
      anOrder({ id: "o2", customerId: "c2", customerName: "Rudo", deliveryCostCents: 150 }),
    ],
    waste: [
      { menuItemId: "brownie", name: "Brownies", day: "2026-08-06", qtyMilli: 4_000, valueCents: 424 },
    ],
  });

  test("every branch plus profit equals what came in, to the cent", () => {
    const pnl = periodPnl(busy);
    const tree = sankeyFrom(pnl);
    const out = tree.links.reduce((a, l) => a + l.value, 0);
    // Revenue in = every outflow + profit. If this ever drifts, the most
    // important chart in Sous is lying about where the money went.
    expect(out).toBe(pnl.grossRevenueCents);
  });

  test("a zero branch is absent, not drawn as a hairline", () => {
    const tree = sankeyFrom(periodPnl(input()));
    const names = tree.nodes.map((n) => n.name);
    expect(names).not.toContain("Discounts");
    expect(names).not.toContain("Waste");
    expect(names).not.toContain("VAT");
    expect(names).toContain("Profit");
  });

  test("links point at real node indices", () => {
    const tree = sankeyFrom(periodPnl(busy));
    for (const link of tree.links) {
      expect(tree.nodes[link.target]).toBeDefined();
      expect(link.source).toBe(0);
    }
  });
});

describe("ACCEPTANCE: period basis", () => {
  test("waste from a batch baked for last month lands in this month", () => {
    const pnl = periodPnl(
      input({
        waste: [
          {
            menuItemId: "brownie",
            name: "Brownies",
            // Baked in July for a July order; it expired in August.
            day: "2026-08-02",
            qtyMilli: 6_000,
            valueCents: 636,
          },
        ],
      }),
    );
    expect(pnl.wasteCents).toBe(636);
    expect(pnl.profitCents).toBe(3_000 - 1_060 - 636);
  });

  test("so the per-order ranking deliberately does NOT sum to the headline", () => {
    const withWaste = input({
      waste: [
        { menuItemId: "brownie", name: "Brownies", day: "2026-08-02", qtyMilli: 6_000, valueCents: 636 },
      ],
    });
    const pnl = periodPnl(withWaste);
    const perOrder = rankOrders(withWaste.orders).reduce((a, o) => a + o.profitCents, 0);
    // Waste belongs to no order, so the two figures differ BY the waste. The
    // screen states this rather than letting her find it and lose trust.
    expect(perOrder - pnl.profitCents).toBe(636);
  });
});

describe("what is hurting it", () => {
  test("ranked by dollars, and the Sankey agrees with the sentence", () => {
    const busy = input({
      orders: [anOrder({ discountCents: 200, deliveryFeeCents: 100, deliveryCostCents: 900 })],
      waste: [
        { menuItemId: "brownie", name: "Brownies", day: "2026-08-06", qtyMilli: 40_000, valueCents: 9_600 },
      ],
      drift: [{ ingredientId: "butter", name: "Butter", excessCents: 4_700 }],
    });
    const pnl = periodPnl(busy);
    const leaks = rankLeaks(pnl, busy, "/k");

    expect(leaks[0].kind).toBe("waste");
    expect(leaks[0].cents).toBe(9_600);
    expect(leaks[0].sentence).toContain("$96.00");
    expect(leaks[0].sentence).toContain("Brownies");
    // Sorted, strictly.
    for (let i = 1; i < leaks.length; i++) {
      expect(leaks[i - 1].cents).toBeGreaterThanOrEqual(leaks[i].cents);
    }
    // Every leak has somewhere to go.
    for (const leak of leaks) expect(leak.href.startsWith("/k")).toBe(true);
  });

  test("it flags, it never instructs", () => {
    const busy = input({
      waste: [
        { menuItemId: "brownie", name: "Brownies", day: "2026-08-06", qtyMilli: 40_000, valueCents: 9_600 },
      ],
      drift: [{ ingredientId: "butter", name: "Butter", excessCents: 4_700 }],
      orders: [anOrder({ discountCents: 200, deliveryCostCents: 900 })],
    });
    const leaks = rankLeaks(periodPnl(busy), busy, "/k");
    for (const leak of leaks) {
      // CONTEXT.md: Sous states arithmetic. It has no knowledge of demand and
      // must never pretend otherwise.
      expect(leak.sentence).not.toMatch(/\b(raise|lower|stop|should|must|increase|reduce)\b/i);
    }
  });

  test("a leak with no dollars behind it does not appear at all", () => {
    const leaks = rankLeaks(periodPnl(input()), input(), "/k");
    expect(leaks.map((l) => l.kind)).not.toContain("waste");
    expect(leaks.map((l) => l.kind)).not.toContain("discounts");
  });

  test("drift says out loud that it only knows about well-bought ingredients", () => {
    const withDrift = input({ drift: [{ ingredientId: "b", name: "Butter", excessCents: 500 }] });
    const drift = rankLeaks(periodPnl(withDrift), withDrift, "/k").find((l) => l.kind === "drift")!;
    expect(drift.caveat).toContain("three times");
  });

  test("below-target ranks by the dollar gap, not by how many orders missed", () => {
    // One order 30 points under beats two orders 1 point under.
    const badly = input({
      orders: [anOrder({ discountCents: 1_500 })],
      targetNetMarginPercent: 60,
    });
    const leak = rankLeaks(periodPnl(badly), badly, "/k").find((l) => l.kind === "belowTarget");
    expect(leak).toBeDefined();
    expect(leak!.cents).toBeGreaterThan(0);
  });

  test("no target set means no below-target leak, rather than a leak against zero", () => {
    const noTarget = input({ targetNetMarginPercent: null });
    const leaks = rankLeaks(periodPnl(noTarget), noTarget, "/k");
    expect(leaks.map((l) => l.kind)).not.toContain("belowTarget");
  });
});

describe("the drill-downs", () => {
  test("ACCEPTANCE: a good item plus a discount plus fuel ships at a loss", () => {
    // Every line is a healthy 65% item. The order still loses money.
    const orders = [
      anOrder({ id: "good" }),
      anOrder({
        id: "quietly-bad",
        customerName: "Rudo Chikafu",
        discountCents: 1_200,
        deliveryFeeCents: 0,
        deliveryCostCents: 900,
      }),
    ];
    const ranked = rankOrders(orders);
    expect(ranked[0].orderId).toBe("quietly-bad");
    expect(ranked[0].profitCents).toBeLessThan(0);
    // And it says why, because "you lost money" without a cause is unusable.
    expect(ranked[0].reason).toContain("discount");
    expect(ranked[0].reason).toContain("fuel");
    expect(ranked[1].reason).toBeNull();
  });

  test("the reframe: the top seller by volume can be the worst earner", () => {
    const CHEAP = {
      menuItemId: "scone",
      description: "Scones",
      unitPriceCents: 150,
      // 140c cost on a 150c price: sells constantly, earns almost nothing.
      cogsSnapshot: { ingredientsCents: 60, perUnitExtrasCents: 20, overheadCents: 60 },
    };
    const rows = rankItems(
      [
        anOrder({
          lines: [
            { ...BROWNIE, qtyMilli: 10_000 },
            { ...CHEAP, qtyMilli: 100_000 },
          ],
        }),
      ],
      new Map([
        ["brownie", 5],
        ["scone", 3],
      ]),
    );
    const scones = rows.find((r) => r.menuItemId === "scone")!;
    const brownies = rows.find((r) => r.menuItemId === "brownie")!;
    // Scones outsell brownies ten to one…
    expect(scones.unitsMilli).toBeGreaterThan(brownies.unitsMilli);
    // …and earn less.
    expect(scones.profitCents).toBeLessThan(brownies.profitCents);
    // rankGap is the reframe made numeric: last by profit, first by units.
    expect(scones.rankGap).toBeGreaterThan(0);
    expect(brownies.rankGap).toBeLessThan(0);
    // Production time is carried for the scatter's size buckets.
    expect(scones.productionMinutes).toBe(300);
  });

  test("walk-ins share one bucket rather than becoming many customers", () => {
    const rows = rankCustomers([
      anOrder({ id: "a", customerId: null, customerName: "Counter sale" }),
      anOrder({ id: "b", customerId: null, customerName: "Counter sale" }),
      anOrder({ id: "c" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.customerId === null)!.orders).toBe(2);
  });
});

describe("over time, and the cost hierarchy", () => {
  const busy = input({
    orders: [
      anOrder({ id: "a", deliveryDate: "2026-08-01" }),
      anOrder({ id: "b", deliveryDate: "2026-08-01", deliveryCostCents: 200 }),
      anOrder({ id: "c", deliveryDate: "2026-08-05" }),
    ],
    waste: [
      { menuItemId: "brownie", name: "Brownies", day: "2026-08-03", qtyMilli: 2_000, valueCents: 212 },
    ],
  });

  test("the series buckets by day, and waste lands on its own day", () => {
    const rows = dailySeries(busy);
    expect(rows.map((r) => r.date)).toEqual(["2026-08-01", "2026-08-03", "2026-08-05"]);
    // The 3rd has no revenue at all — only the waste that expired on it.
    const third = rows.find((r) => r.date === "2026-08-03")!;
    expect(third.revenueCents).toBe(0);
    expect(third.costCents).toBe(212);
    expect(third.profitCents).toBe(-212);
    // And the series totals reconcile with the period claim.
    const pnl = periodPnl(busy);
    expect(rows.reduce((a, r) => a + r.profitCents, 0)).toBe(pnl.profitCents);
  });

  test("ACCEPTANCE: a cost node carries a value OR children, never both", () => {
    const pnl = periodPnl(busy);
    const tree = costTree(pnl, rankItems(busy.orders, new Map([["brownie", 5]])));
    const walk = (n: { value?: number; children?: unknown[] }) => {
      // Setting both double-counts the branch and the sunburst stops closing
      // the circle — it draws ~270 degrees and looks odd rather than wrong.
      expect(n.value !== undefined && n.children !== undefined).toBe(false);
      (n.children ?? []).forEach((c) => walk(c as never));
    };
    walk(tree);
    // And the leaves under a branch sum to what that branch was worth.
    const ingredients = tree.children!.find((c) => c.name === "Ingredients")!;
    const leaves = (ingredients.children ?? []).reduce((a, c) => a + (c.value ?? 0), 0);
    expect(Math.abs(leaves - pnl.ingredientsCents)).toBeLessThanOrEqual(1);
  });
});

describe("the shapes she will actually have", () => {
  test("three orders — every figure still resolves", () => {
    const three = input({
      orders: [anOrder({ id: "a" }), anOrder({ id: "b" }), anOrder({ id: "c" })],
    });
    const pnl = periodPnl(three);
    expect(pnl.orderCount).toBe(3);
    expect(pnl.netMarginPercent).toBe(65);
    expect(rankOrders(three.orders)).toHaveLength(3);
    expect(sankeyFrom(pnl).links.length).toBeGreaterThan(0);
  });

  test("four hundred orders — arithmetic holds and the balance still ties", () => {
    const many = input({
      orders: Array.from({ length: 400 }, (_, i) =>
        anOrder({
          id: `o${i}`,
          customerId: `c${i % 40}`,
          customerName: `Customer ${i % 40}`,
          discountCents: i % 7 === 0 ? 100 : 0,
          deliveryFeeCents: i % 3 === 0 ? 500 : 0,
          deliveryCostCents: i % 3 === 0 ? 420 : 0,
        }),
      ),
    });
    const pnl = periodPnl(many);
    expect(pnl.orderCount).toBe(400);
    const tree = sankeyFrom(pnl);
    expect(tree.links.reduce((a, l) => a + l.value, 0)).toBe(pnl.grossRevenueCents);
    // 40 distinct customers, not 400.
    expect(rankCustomers(many.orders)).toHaveLength(40);
  });
});
