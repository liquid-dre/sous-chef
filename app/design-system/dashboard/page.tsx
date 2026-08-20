"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { ReceiptText } from "lucide-react";
import {
  costTree,
  dailySeries,
  periodPnl,
  rankItems,
  rankLeaks,
  sankeyFrom,
  type PnlInput,
  type PnlOrder,
} from "@/convex/lib/pnl";
import { Claim } from "@/components/dashboard/claim";
import { LeakList } from "@/components/dashboard/leak-list";
import { MoneyFlow } from "@/components/dashboard/money-flow";
import { UncostedRing } from "@/components/dashboard/uncosted-ring";
import {
  ProfitOverTime,
  RevenueVersusCost,
} from "@/components/dashboard/trend-charts";
import {
  QuadrantNote,
  VolumeProfitScatter,
} from "@/components/dashboard/volume-profit-scatter";
import { CostSunburst } from "@/components/dashboard/cost-sunburst";

/**
 * Home specimen — the grading surface for the screen the product exists for.
 *
 * The fixtures run through the REAL engine (convex/lib/pnl.ts is pure, so it
 * imports straight into the browser), which means every figure here is
 * arithmetic rather than a plausible-looking constant. If the Sankey stops
 * balancing, this page shows it.
 *
 * Three shapes, because those are the three that exist: a kitchen on day one,
 * a kitchen three orders in, and a kitchen a year in.
 */

const BROWNIE = {
  menuItemId: "brownie",
  description: "Brownies",
  unitPriceCents: 300,
  cogsSnapshot: { ingredientsCents: 15, perUnitExtrasCents: 20, overheadCents: 71 },
};
const SCONE = {
  menuItemId: "scone",
  description: "Scones",
  unitPriceCents: 150,
  // Sells constantly, earns almost nothing — the reframe, in fixture form.
  cogsSnapshot: { ingredientsCents: 60, perUnitExtrasCents: 20, overheadCents: 60 },
};
const CAKE = {
  menuItemId: "cake",
  description: "Chocolate fudge cake",
  unitPriceCents: 3_200,
  cogsSnapshot: { ingredientsCents: 640, perUnitExtrasCents: 90, overheadCents: 420 },
};

function order(i: number, over: Partial<PnlOrder> = {}): PnlOrder {
  return {
    id: `o${i}`,
    deliveryDate: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
    customerId: `c${i % 23}`,
    customerName:
      ["Tariro Moyo", "Rudo Chikafu", "Tanaka Ncube", "Chipo Dube"][i % 4] +
      (i % 23 > 3 ? ` ${i % 23}` : ""),
    discountCents: i % 6 === 0 ? 250 : 0,
    deliveryFeeCents: i % 3 === 0 ? 500 : 0,
    deliveryCostCents: i % 3 === 0 ? (i % 9 === 0 ? 900 : 380) : 0,
    taxRateBpAtCreation: 0,
    taxInclusiveAtCreation: false,
    lines: [
      { ...BROWNIE, qtyMilli: ((i % 4) + 1) * 1_000 },
      ...(i % 2 === 0 ? [{ ...SCONE, qtyMilli: ((i % 9) + 4) * 1_000 }] : []),
      ...(i % 7 === 0 ? [{ ...CAKE, qtyMilli: 1_000 }] : []),
      ...(i % 11 === 0
        ? [
            {
              menuItemId: null,
              description: "Catering, off menu",
              qtyMilli: 1_000,
              unitPriceCents: 4_500,
            },
          ]
        : []),
    ],
    ...over,
  };
}

function fixture(count: number): PnlInput {
  return {
    orders: Array.from({ length: count }, (_, i) => order(i)),
    // Spread across the month, because that is how food goes off — a lump on
    // two days made the margin line dive to -300% and read as a broken chart
    // rather than as a fixture that did not resemble a kitchen.
    waste:
      count === 0
        ? []
        : Array.from({ length: Math.min(count, 14) }, (_, i) => ({
            menuItemId: i % 2 === 0 ? "brownie" : "scone",
            name: i % 2 === 0 ? "Brownies" : "Scones",
            day: `2026-08-${String((i * 2) + 2).padStart(2, "0")}`,
            qtyMilli: Math.round((count * 900) / 14),
            valueCents: Math.round(((count * 900) / 14) * 0.106),
          })),
    drift:
      count > 10
        ? [
            { ingredientId: "butter", name: "Butter", excessCents: 4_120 },
            { ingredientId: "flour", name: "Flour", excessCents: 860 },
          ]
        : [],
    targetNetMarginPercent: 35,
  };
}

const SHAPES = [
  { key: "none", label: "Day one", count: 0 },
  { key: "three", label: "Three orders", count: 3 },
  { key: "many", label: "400 orders", count: 400 },
] as const;

type ShapeKey = (typeof SHAPES)[number]["key"];

export default function DashboardSpecimenPage() {
  const [shape, setShape] = React.useState<ShapeKey>("many");
  const count = SHAPES.find((s) => s.key === shape)!.count;

  const input = React.useMemo(() => fixture(count), [count]);
  const pnl = React.useMemo(() => periodPnl(input), [input]);
  const leaks = React.useMemo(
    () => rankLeaks(pnl, input, "/kitchen-a"),
    [pnl, input],
  );
  const sankey = React.useMemo(() => sankeyFrom(pnl), [pnl]);
  // Minutes per unit for the scatter's size buckets: brownies are quick,
  // a fudge cake is not.
  const items = React.useMemo(
    () =>
      rankItems(
        input.orders,
        new Map([
          ["brownie", 5],
          ["scone", 2],
          ["cake", 90],
        ]),
      ),
    [input],
  );
  const series = React.useMemo(() => dailySeries(input), [input]);
  const tree = React.useMemo(() => costTree(pnl, items), [pnl, items]);

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Home specimen — real arithmetic, through convex/lib/pnl.ts
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Tabs value={shape} onValueChange={(v) => setShape(v as ShapeKey)}>
            <TabsList>
              {SHAPES.map((s) => (
                <TabsTrigger key={s.key} value={s.key}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-10">
        {count === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="Nothing delivered yet"
            body="Take an order and mark it delivered, and this becomes one sentence about whether you made money."
            actionLabel="Take an order"
            actionHref="/kitchen-a/orders/new"
          />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Claim
                  data={{
                    periodLabel: "This month",
                    ...pnl,
                    previousPeriodMarginPercent: count > 10 ? 31 : null,
                    rollingFourWeekMarginPercent: count > 10 ? 29 : null,
                  }}
                />
              </div>
              {pnl.uncostedRevenueCents > 0 && (
                <UncostedRing sharePercent={pnl.uncostedSharePercent} />
              )}
            </div>

            <LeakList leaks={leaks} />

            <MoneyFlow
              data={sankey}
              periodLabel="This month"
              orderCount={pnl.orderCount}
            />

            <ProfitOverTime
              rows={series}
              periodLabel="This month"
              targetNetMarginPercent={pnl.targetNetMarginPercent}
            />
            <RevenueVersusCost rows={series} periodLabel="This month" />
            <VolumeProfitScatter items={items} periodLabel="This month" />
            <QuadrantNote items={items} />
            <CostSunburst
              data={tree}
              periodLabel="This month"
              orderCount={pnl.orderCount}
            />

            {/* The specimen's own check: if this ever prints a difference,
                the most important chart in Sous is lying. */}
            <p className="type-caption text-muted-foreground">
              Sankey balance:{" "}
              <span className="numeric">
                {sankey.links.reduce((a, l) => a + l.value, 0) ===
                pnl.grossRevenueCents
                  ? "ties to the cent"
                  : "OUT BY " +
                    (pnl.grossRevenueCents -
                      sankey.links.reduce((a, l) => a + l.value, 0))}
              </span>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
