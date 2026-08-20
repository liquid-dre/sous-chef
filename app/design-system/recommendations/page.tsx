"use client";

import * as React from "react";
import { CircleCheck, Sparkles } from "lucide-react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import Link from "next/link";
import { periodCauses, periodPnl, type PnlInput, type PnlOrder } from "@/convex/lib/pnl";
import {
  rankRecommendations,
  type Dismissal,
  type StructuralFacts,
  type Trend,
} from "@/convex/lib/recommendations";
import { ImpactBars } from "@/components/recommendations/impact-bars";
import {
  RecommendationCard,
  type CardRow,
} from "@/components/recommendations/recommendation-card";

/**
 * Recommendations specimen — the grading surface for the list she acts on.
 *
 * The fixtures run through the REAL engine (convex/lib/recommendations.ts is
 * pure, so it imports straight into the browser), which means every figure
 * here is arithmetic rather than a plausible-looking constant. If a card's
 * money ever stops matching its causes, this page shows it — there is a
 * running check at the foot that adds the bars up against the list.
 *
 * Four shapes, because those are the ones that exist: a kitchen with nothing
 * costed, a healthy kitchen (which is a real outcome, not an absence), a
 * kitchen with one thing wrong, and a kitchen with all six sources firing at
 * once.
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
  cogsSnapshot: { ingredientsCents: 60, perUnitExtrasCents: 20, overheadCents: 60 },
};

function order(i: number, over: Partial<PnlOrder> = {}): PnlOrder {
  return {
    id: `o${i}`,
    deliveryDate: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
    customerId: `c${i % 7}`,
    customerName: ["Tariro Moyo", "Rudo Chikafu", "Tanaka Ncube"][i % 3],
    discountCents: i % 6 === 0 ? 250 : 0,
    deliveryFeeCents: i % 3 === 0 ? 500 : 0,
    deliveryCostCents: i % 3 === 0 ? (i % 9 === 0 ? 1_400 : 380) : 0,
    taxRateBpAtCreation: 0,
    taxInclusiveAtCreation: false,
    lines: [
      { ...BROWNIE, qtyMilli: ((i % 4) + 1) * 1_000 },
      ...(i % 2 === 0 ? [{ ...SCONE, qtyMilli: ((i % 9) + 4) * 1_000 }] : []),
    ],
    ...over,
  };
}

type ShapeKey = "empty" | "healthy" | "one" | "all";

function pnlFixture(shape: ShapeKey): PnlInput {
  if (shape === "empty") {
    return { orders: [], waste: [], drift: [], targetNetMarginPercent: 35 };
  }
  const orders =
    shape === "healthy"
      ? // A genuinely clean month, which took more than removing the
        // discounts: the browser showed this fixture still emitting an
        // $11.66 below-target row, because Scones cost 93% of what they sell
        // for and drag every order under a 35% net target. Scones are out.
        Array.from({ length: 18 }, (_, i) =>
          order(i, {
            discountCents: 0,
            deliveryCostCents: 0,
            lines: [{ ...BROWNIE, qtyMilli: ((i % 4) + 1) * 1_000 }],
          }),
        )
      : Array.from({ length: 24 }, (_, i) => order(i));
  return {
    orders,
    waste:
      shape === "healthy"
        ? []
        : Array.from({ length: shape === "one" ? 6 : 12 }, (_, i) => ({
            menuItemId: i % 2 === 0 ? "brownie" : "scone",
            name: i % 2 === 0 ? "Brownies" : "Scones",
            day: `2026-08-${String(i * 2 + 2).padStart(2, "0")}`,
            qtyMilli: 4_000,
            valueCents: 424,
          })),
    drift:
      shape === "all"
        ? [
            { ingredientId: "butter", name: "Butter", excessCents: 4_120 },
            { ingredientId: "flour", name: "Flour", excessCents: 860 },
          ]
        : [],
    targetNetMarginPercent: 35,
  };
}

function structuralFixture(shape: ShapeKey): StructuralFacts[] {
  if (shape !== "all") return [];
  return [
    {
      menuItemId: "brownie",
      name: "Brownies",
      underpriced: {
        priceNowCents: 300,
        priceToReachTargetCents: 340,
        targetPercent: 65,
        grossMarginNowPercent: 58,
        unitsMilli: 62_000,
        verdictHeadline: null,
      },
      batch: { baseBatchYield: 12, typicalOrderUnits: 3 },
      stalePrice: { priceSetDay: "2026-04-04", days: 123 },
    },
    {
      menuItemId: "lemon-tart",
      name: "Lemon tart",
      dormant: {
        lastOrderedDay: "2026-05-21",
        quietDays: 75,
        windowDays: 60,
        priorRevenueCents: 6_400,
      },
    },
    {
      menuItemId: "banana-bread",
      name: "Banana bread",
      stalePrice: { priceSetDay: "2026-02-19", days: 166 },
    },
    {
      menuItemId: "carrot-cake",
      name: "Carrot cake",
      stalePrice: { priceSetDay: "2026-03-30", days: 127 },
    },
  ];
}

/** Trends only where trend IS the argument. Butter has a real climb; flour has
 * three purchases, which is below the floor and must be suppressed. */
function trendFixture(shape: ShapeKey): Record<string, Trend> {
  if (shape !== "all") return {};
  return {
    "ingredient:butter": {
      label: "What you paid",
      points: Array.from({ length: 11 }, (_, i) => ({
        date: `2026-0${i < 5 ? 6 : i < 9 ? 7 : 8}-${String((i % 5) * 6 + 2).padStart(2, "0")}`,
        value: 1_850 + i * 95 + (i % 3) * 40,
      })),
    },
    "ingredient:flour": {
      label: "What you paid",
      points: [
        { date: "2026-07-02", value: 185 },
        { date: "2026-07-20", value: 210 },
        { date: "2026-08-01", value: 240 },
      ],
    },
    "item:lemon-tart": {
      label: "Units a week",
      points: Array.from({ length: 17 }, (_, i) => ({
        date: `2026-0${i < 4 ? 4 : i < 9 ? 5 : i < 13 ? 6 : 7}-${String((i % 4) * 7 + 3).padStart(2, "0")}`,
        value: i < 8 ? 3 + (i % 3) : 0,
      })),
    },
  };
}

const SHAPES = [
  { key: "empty", label: "Day one" },
  { key: "healthy", label: "Nothing wrong" },
  { key: "one", label: "One thing" },
  { key: "all", label: "All six sources" },
] as const;

export default function RecommendationsSpecimenPage() {
  const [shape, setShape] = React.useState<ShapeKey>("all");
  /**
   * Real dismissal rows, not flags.
   *
   * The first draft stored `dismissedAtCents: MAX_SAFE_INTEGER` meaning "never
   * come back", and nothing was ever dismissed — the rule resurfaces on a
   * large move in EITHER direction, so a figure of MAX against an actual $41
   * is a 100% drop and comes straight back. Recording what the card really
   * said makes the specimen exercise the rule rather than fight it.
   */
  const [dismissed, setDismissed] = React.useState<Dismissal[]>([]);
  const [leaving, setLeaving] = React.useState<string | null>(null);

  /** The real screen animates the row out before the mutation lands; the
   * specimen has to do the same or the motion cannot be graded here. */
  const setAside = (row: CardRow) => {
    setLeaving(row.subjectKey);
    setTimeout(() => {
      setDismissed((d) => [
        ...d,
        {
          subjectKey: row.subjectKey,
          dismissedAt: 0,
          dismissedAtCents: row.cents,
          causeKinds: row.causes.map((c) => c.kind),
        },
      ]);
      setLeaving(null);
    }, 200);
  };

  const result = React.useMemo(() => {
    const input = pnlFixture(shape);
    return rankRecommendations({
      base: "/kitchen-a",
      period: periodCauses(periodPnl(input), input),
      structural: structuralFixture(shape),
      trends: trendFixture(shape),
      dismissals: dismissed,
    });
  }, [shape, dismissed]);

  const rows = result.live as CardRow[];
  const barTotal = rows.reduce((a, r) => a + r.cents, 0);
  const causeTotal = rows
    .flatMap((r) => r.causes)
    .reduce((a, c) => a + c.cents, 0);

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Recommendations specimen — real arithmetic, through
          convex/lib/recommendations.ts
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Tabs
            value={shape}
            onValueChange={(v) => {
              setShape(v as ShapeKey);
              setDismissed([]);
            }}
          >
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

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10">
        <h1 className="type-display-sm">What to fix</h1>

        {shape === "empty" ? (
          <EmptyState
            icon={Sparkles}
            title="Nothing to suggest yet"
            body="Cost a menu item and take a few orders, and anything worth fixing turns up here."
            actionLabel="Add a menu item"
            actionHref="/kitchen-a/menu/new"
          />
        ) : rows.length === 0 ? (
          <section className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center">
            <CircleCheck aria-hidden className="size-6 text-profit" strokeWidth={1.5} />
            <h2 className="type-display-sm text-balance">Nothing is leaking</h2>
            <p className="type-body max-w-md text-pretty text-muted-foreground">
              Every item is at or above the margin you set for it, no ingredient
              has moved past your cost threshold, nothing was baked and not
              sold, and every delivery covered its own fuel.
            </p>
            <p className="type-caption text-muted-foreground">
              Checked against this month.
            </p>
          </section>
        ) : (
          <>
            <ImpactBars
              rows={rows.map((r) => ({ name: r.subjectName, cents: r.cents }))}
              periodLabel="This month"
            />
            <section aria-label="Recommendations" className="flex flex-col gap-3">
              {rows.map((row, i) => (
                <RecommendationCard
                  key={row.subjectKey}
                  row={row}
                  rank={i + 1}
                  leaving={leaving === row.subjectKey}
                  onDismiss={() => setAside(row)}
                />
              ))}
            </section>
          </>
        )}

        {result.stale.length > 0 && (
          <section className="flex flex-col gap-2 border-t pt-4">
            <h2 className="type-label text-muted-foreground">Worth a look</h2>
            <p className="type-body text-muted-foreground">
              {result.stale.length} items were priced more than 90 days ago.
              Nothing says the prices are wrong — only that nothing has checked
              them against what things cost now.
            </p>
            <ul className="flex flex-wrap gap-2">
              {result.stale.map((item) => (
                <li key={item.menuItemId}>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={item.href}>
                      {item.name}{" "}
                      <span className="text-muted-foreground">{item.days}d</span>
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {result.dismissed.length > 0 && (
          <details className="border-t pt-4">
            <summary className="type-label min-h-11 cursor-pointer text-muted-foreground">
              Set aside ({result.dismissed.length})
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {(result.dismissed as CardRow[]).map((row) => (
                <RecommendationCard
                  key={row.subjectKey}
                  row={row}
                  onRestore={() =>
                    setDismissed((d) =>
                      d.filter((x) => x.subjectKey !== row.subjectKey),
                    )
                  }
                />
              ))}
            </div>
          </details>
        )}

        {/* The specimen's own check: if this ever prints a difference, a card
            is claiming money its causes do not account for, and the bar chart
            above stops summing to the list below it. */}
        <p className="type-caption text-muted-foreground">
          Bars against causes:{" "}
          <span className="numeric">
            {barTotal === causeTotal
              ? "ties to the cent"
              : `OUT BY ${barTotal - causeTotal}`}
          </span>
        </p>
      </main>
    </div>
  );
}
