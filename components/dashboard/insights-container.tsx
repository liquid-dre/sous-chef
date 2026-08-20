"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { ChartNoAxesColumn } from "lucide-react";
import { useClientToday } from "@/components/use-client-today";
import {
  PeriodProvider,
  PeriodSwitcher,
  usePeriod,
} from "@/components/charts-sous/use-period";
import { formatMoneyExact } from "@/components/charts-sous/format";
import { splitSigned, type RankedRow } from "./ranked-bars";

/**
 * Behind the tap: the three rankings and the reframe.
 *
 * Charts are dynamically imported here too. A drill-down is reached
 * deliberately, but it is still reached on a phone on 3G, and there is no
 * reason for its bundle to be in the tab that opened it.
 */

const skeleton = () => (
  <div className="h-72 animate-pulse rounded-lg border bg-card" />
);

// The options MUST be an object literal at each call site. Sharing one const
// between them compiles under `next dev` and fails `next build` outright —
// Turbopack reads these statically to split the bundle, and a variable is not
// something it can read.
const RankedBars = dynamic(
  () => import("./ranked-bars").then((m) => m.RankedBars),
  { ssr: false, loading: skeleton },
);
const VolumeProfitScatter = dynamic(
  () => import("./volume-profit-scatter").then((m) => m.VolumeProfitScatter),
  { ssr: false, loading: skeleton },
);
const QuadrantNote = dynamic(
  () => import("./volume-profit-scatter").then((m) => m.QuadrantNote),
  { ssr: false },
);
const ProfitOverTime = dynamic(
  () => import("./trend-charts").then((m) => m.ProfitOverTime),
  { ssr: false, loading: skeleton },
);
const RevenueVersusCost = dynamic(
  () => import("./trend-charts").then((m) => m.RevenueVersusCost),
  { ssr: false, loading: skeleton },
);
const CostSunburst = dynamic(
  () => import("./cost-sunburst").then((m) => m.CostSunburst),
  { ssr: false, loading: skeleton },
);

export type InsightView = "items" | "orders" | "customers" | "trend";

const TITLES: Record<InsightView, string> = {
  items: "What each item earns you",
  orders: "Which orders went wrong",
  customers: "What each customer is worth",
  trend: "How it's moving",
};

export function InsightsContainer({
  orgSlug,
  view,
}: {
  orgSlug: string;
  view: InsightView;
}) {
  return (
    <PeriodProvider defaultPeriod="month">
      <Inner orgSlug={orgSlug} view={view} />
    </PeriodProvider>
  );
}

/** Item ranking, three ways — and the gap between them is the point. */
type ItemMetric = "profit" | "revenue" | "units";

function Inner({ orgSlug, view }: { orgSlug: string; view: InsightView }) {
  const today = useClientToday();
  const { bounds, label } = usePeriod();
  const [metric, setMetric] = React.useState<ItemMetric>("profit");

  const data = useQuery(
    api.dashboard.breakdown,
    today ? { orgSlug, start: bounds.start, end: bounds.end } : "skip",
  );

  const header = (
    <div className="flex flex-col gap-3">
      <Button variant="ghost" size="sm" className="-ml-2 self-start" asChild>
        <Link href={`/${orgSlug}`}>
          <ArrowLeft aria-hidden /> Home
        </Link>
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-display-sm">{TITLES[view]}</h1>
        <PeriodSwitcher />
      </div>
    </div>
  );

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        {header}
        <div className="h-72 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  const empty =
    (view === "items" && data.items.length === 0) ||
    (view === "orders" && data.orders.length === 0) ||
    (view === "customers" && data.customers.length === 0) ||
    (view === "trend" && data.series.length === 0);

  if (empty) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        {header}
        <EmptyState
          icon={ChartNoAxesColumn}
          title="Nothing to rank yet"
          body="Deliver an order in this period and it appears here, worst first."
          actionLabel="See your orders"
          actionHref={`/${orgSlug}/orders`}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {header}

      {view === "items" && (
        <>
          <Tabs value={metric} onValueChange={(v) => setMetric(v as ItemMetric)}>
            <TabsList>
              <TabsTrigger value="profit">Profit</TabsTrigger>
              <TabsTrigger value="revenue">Revenue</TabsTrigger>
              <TabsTrigger value="units">Units</TabsTrigger>
            </TabsList>
          </Tabs>

          <RankedBars
            title={
              metric === "profit"
                ? "Profit contribution"
                : metric === "revenue"
                  ? "Revenue"
                  : "Units sold"
            }
            periodLabel={label}
            sampleSize={data.items.length}
            sampleNoun="items"
            emptyBody="Deliver an order and its items appear here."
            formatValue={(c) =>
              metric === "units" ? `${c / 1000}` : formatMoneyExact(c)
            }
            rows={itemRows(data.items, metric)}
            caption="The order changes with the metric. That change is the point."
          />

          <Reframe items={data.items} />

          {/* The 2D view, which no ranking can show: high volume AND low
              profit is two axes by nature. */}
          <VolumeProfitScatter items={data.items} periodLabel={label} />
          <QuadrantNote items={data.items} />
        </>
      )}

      {view === "orders" && (
        <>
          <RankedBars
            title="Worst first"
            periodLabel={label}
            sampleSize={data.orders.length}
            sampleNoun="orders"
            emptyBody="Deliver an order and it appears here."
            formatValue={formatMoneyExact}
            rows={data.orders
              .slice(0, 12)
              .map((o) => splitSigned(o.customerName, o.profitCents))}
          />
          {/* Said out loud, because she WILL add these up. */}
          {data.unattributedWasteCents > 0 && (
            <p className="type-caption text-muted-foreground">
              These don&rsquo;t add up to the figure on Home:{" "}
              <span className="numeric">
                {formatMoneyExact(data.unattributedWasteCents)}
              </span>{" "}
              of waste belongs to no single order, so it sits in the total and
              not in this list.
            </p>
          )}
          <ul className="flex flex-col divide-y border-t">
            {data.orders.slice(0, 12).map((o) => (
              <li
                key={o.orderId}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2"
              >
                <Link
                  href={`/${orgSlug}/orders/${o.orderId}`}
                  className="type-body min-w-0 flex-1 truncate outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {o.customerName}
                  {o.reason && (
                    <span className="type-caption block text-muted-foreground">
                      {o.reason}
                    </span>
                  )}
                </Link>
                <span className="numeric-sm shrink-0">
                  {formatMoneyExact(o.profitCents)}
                  {o.marginPercent != null && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {o.marginPercent}%
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {view === "trend" && (
        <>
          <ProfitOverTime
            rows={data.series}
            periodLabel={label}
            targetNetMarginPercent={data.targetNetMarginPercent}
          />
          <RevenueVersusCost rows={data.series} periodLabel={label} />
          <CostSunburst
            data={data.costTree}
            periodLabel={label}
            orderCount={data.orders.length}
          />
        </>
      )}

      {view === "customers" && (
        <RankedBars
          title="Worst first"
          periodLabel={label}
          sampleSize={data.customers.length}
          sampleNoun="customers"
          emptyBody="Deliver an order and the customer appears here."
          formatValue={formatMoneyExact}
          rows={data.customers
            .slice(0, 12)
            .map((c) => splitSigned(c.name, c.profitCents))}
        />
      )}
    </div>
  );
}

function itemRows(
  items: { name: string; profitCents: number; revenueCents: number; unitsMilli: number }[],
  metric: ItemMetric,
): RankedRow[] {
  const key =
    metric === "profit" ? "profitCents" : metric === "revenue" ? "revenueCents" : "unitsMilli";
  return [...items]
    .sort((a, b) => (b[key] as number) - (a[key] as number))
    .slice(0, 12)
    .map((i) => splitSigned(i.name, i[key] as number));
}

/**
 * The reframe, stated rather than left for her to spot: the top seller by
 * volume is very often the worst earner.
 *
 * It FLAGS. Two percentages and a name — she draws the conclusion. Chefs keep
 * items for reasons Sous cannot see, and an app that says "drop it" gets
 * closed (CONTEXT.md).
 */
function Reframe({
  items,
}: {
  items: { name: string; profitCents: number; unitsMilli: number; rankGap: number }[];
}) {
  if (items.length < 3) return null;
  const worst = [...items].sort((a, b) => b.rankGap - a.rankGap)[0];
  if (!worst || worst.rankGap <= 0) return null;

  const totalUnits = items.reduce((a, i) => a + i.unitsMilli, 0);
  const totalProfit = items.reduce((a, i) => a + Math.max(0, i.profitCents), 0);
  if (totalUnits === 0 || totalProfit === 0) return null;

  const unitShare = Math.round((worst.unitsMilli * 100) / totalUnits);
  const profitShare = Math.round((Math.max(0, worst.profitCents) * 100) / totalProfit);
  if (unitShare <= profitShare) return null;

  return (
    <section
      aria-label="Worth a look"
      className="rounded-lg border bg-card p-4 md:p-5"
    >
      <h2 className="type-label text-muted-foreground">Worth a look</h2>
      <p className="type-body-lg pt-1">
        <span className="font-medium">{worst.name}</span> is{" "}
        <span className="numeric">{unitShare}%</span> of everything you made,
        and <span className="numeric">{profitShare}%</span> of your profit.
      </p>
    </section>
  );
}
