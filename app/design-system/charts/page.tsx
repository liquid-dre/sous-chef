"use client";

import * as React from "react";
import { CalendarDays, LineChart as LineChartIcon } from "lucide-react";

import { AreaChart } from "@/components/charts/area-chart";
import { Area } from "@/components/charts/area";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { ComposedChart } from "@/components/charts/composed-chart";
import { SeriesBar } from "@/components/charts/series-bar";
import { Gauge } from "@/components/charts/gauge";
import { Grid } from "@/components/charts/grid";
import { LineChart } from "@/components/charts/line-chart";
import { Line } from "@/components/charts/line";
import { ProfitLossLine } from "@/components/charts/profit-loss-line";
import { RadarArea } from "@/components/charts/radar-area";
import { RadarAxis } from "@/components/charts/radar-axis";
import { RadarChart } from "@/components/charts/radar-chart";
import { RadarGrid } from "@/components/charts/radar-grid";
import { RadarLabels } from "@/components/charts/radar-labels";
import { RadarMidline } from "@/components/charts-sous/radar-midline";
import { RingChart } from "@/components/charts/ring-chart";
import { Ring } from "@/components/charts/ring";
import { ScatterChart } from "@/components/charts/scatter-chart";
import { Scatter } from "@/components/charts/scatter";
import { SunburstCenter } from "@/components/charts/sunburst-center";
import { SunburstChart } from "@/components/charts/sunburst-chart";
import { buildArcs } from "@/components/charts/sunburst";
import { SunburstSegment } from "@/components/charts/sunburst-segment";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import {
  SankeyChart,
  SankeyLink,
  SankeyNode,
  SankeyTooltip,
} from "@/components/charts/sankey";
import {
  HeatmapCells,
  HeatmapChart,
  HeatmapTooltip,
  HeatmapXAxis,
  HeatmapYAxis,
} from "@/components/charts/heatmap";

import { aggregateByGrain } from "@/components/charts-sous/aggregate";
import { CostTooltip } from "@/components/charts-sous/cost-tooltip";
import {
  formatCount,
  formatMarginTick,
  formatMoneyExact,
  formatMoneyTick,
} from "@/components/charts-sous/format";
import {
  MENU_ITEMS,
  SANKEY_DATA,
  SENSORY_METRICS,
  SENSORY_RATINGS,
  SUNBURST_DATA,
  VARIANCE_ROWS,
  heatmapColumns,
  revenueRows,
  scatterPoints,
  type ChartDataState,
} from "@/components/charts-sous/sample-data";
import { SousChart } from "@/components/charts-sous/sous-chart";
import {
  filterByPeriod,
  PeriodProvider,
  PeriodSwitcher,
  usePeriod,
} from "@/components/charts-sous/use-period";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { usePalette } from "@/components/theme/theme-provider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OrgPalette } from "@/lib/theme/derive";
import { cn } from "@/lib/utils";

/**
 * THE chart reference (DESIGN.md §5): every chart type Sous uses, themed by
 * the org palette with zero per-chart config, semantic colours fixed, all
 * states reachable, both breakpoints. Later slices copy from this page.
 *
 * Motion: every chart root gets a DURATION that settles inside DESIGN.md §6's
 * 300ms ceiling; the mount reveal is epoch-keyed in Bklit, so period/state
 * switches do NOT replay it.
 */

/**
 * 200, not 260: Bar spreads its stagger over a further 40% of the duration,
 * so the last bar lands at duration × 1.4 — 364ms at 260, past the ceiling,
 * versus 280ms at 200. Copy this number, not a larger one: this page is what
 * later slices are built from.
 */
const DURATION = 200;

const PALETTES: { name: string; note: string; palette: OrgPalette }[] = [
  {
    name: "Sous default",
    note: "sea green + copper",
    palette: { primary: "#2E6158", accent: "#B56E3C", tint: "#F7F3EA" },
  },
  {
    name: "Red brand",
    note: "the acceptance case — losses must stay THE red",
    palette: { primary: "#B3261E", accent: "#8C6A2F", tint: "#F8F2EE" },
  },
  {
    name: "Deliberately awful",
    note: "neon yellow — derivation keeps series legible",
    palette: { primary: "#FAFF00", accent: "#00FFC8", tint: "#FFFDF2" },
  },
];

function PaletteSwapper() {
  const { setPalette, palette } = usePalette();
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Org palette">
      {PALETTES.map(({ name, note, palette: p }) => (
        <button
          key={name}
          type="button"
          onClick={() => setPalette(p)}
          aria-pressed={palette.primary === p.primary}
          title={note}
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-md border px-3 type-label outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9",
            palette.primary === p.primary
              ? "border-primary bg-primary-soft text-primary"
              : "bg-card text-muted-foreground hover:bg-muted",
          )}
        >
          <span aria-hidden className="size-3.5 rounded-full border" style={{ backgroundColor: p.primary }} />
          {name}
        </button>
      ))}
    </div>
  );
}

function SemanticStrip() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-card px-4 py-3">
      <span className="type-caption text-muted-foreground">
        Fixed, never hers:
      </span>
      {(
        [
          ["profit", "--chart-profit"],
          ["loss", "--chart-loss"],
          ["amber", "--chart-warn"],
          ["red", "--chart-danger"],
          ["target", "--chart-target"],
          ["projection", "--chart-projection"],
        ] as const
      ).map(([name, varName]) => (
        <span key={name} className="flex items-center gap-1.5 type-caption">
          <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: `var(${varName})` }} />
          {name}
        </span>
      ))}
    </div>
  );
}

// --- Charts ---------------------------------------------------------------

function useRevenue(state: ChartDataState) {
  const { bounds } = usePeriod();
  // One period switcher, every chart in the view listens — and the dense
  // rule re-aggregates whatever the period leaves.
  return React.useMemo(
    () => aggregateByGrain(filterByPeriod(revenueRows(state), bounds)),
    [state, bounds],
  );
}

function RevenueLine({ state }: { state: ChartDataState }) {
  const { label } = usePeriod();
  const { points, grain, sampleSize } = useRevenue(state);
  return (
    <SousChart
      title="Revenue"
      periodLabel={label}
      sampleSize={sampleSize}
      sampleNoun="days"
      grain={grain}
      state={state === "empty" ? "empty" : state === "single" ? "single" : "ready"}
      emptyIcon={LineChartIcon}
      emptyTitle="No sales to draw yet"
      emptyBody="Log your first sale and revenue starts here."
      singleValue={points[0] ? formatMoneyExact(points[0].revenueCents) : undefined}
      singleLabel="Revenue so far"
    >
      <LineChart
        data={points}
        xDataKey="date"
        animationDuration={DURATION}
        yDomainTween={false}
        aspectRatio="2 / 1"
        margin={{ top: 16, right: 12, bottom: 28, left: 56 }}
      >
        <Grid horizontal />
        <Line dataKey="revenueCents" stroke="var(--chart-1)" />
        <XAxis numTicks={5} />
        <YAxis formatValue={(v) => formatMoneyTick(v as number)} />
        <CostTooltip valueKey="revenueCents" valueLabel="Revenue" />
      </LineChart>
    </SousChart>
  );
}

function CashArea({ state }: { state: ChartDataState }) {
  const { label } = usePeriod();
  const { points, grain, sampleSize } = useRevenue(state);
  return (
    <SousChart
      title="Cash received"
      periodLabel={label}
      sampleSize={sampleSize}
      sampleNoun="days"
      grain={grain}
      state={state === "empty" ? "empty" : state === "single" ? "single" : "ready"}
      emptyTitle="No payments yet"
      emptyBody="Payments land here as they're logged against orders."
      singleValue={points[0] ? formatMoneyExact(points[0].revenueCents) : undefined}
      singleLabel="Received so far"
    >
      <AreaChart
        data={points}
        xDataKey="date"
        animationDuration={DURATION}
        aspectRatio="2 / 1"
        margin={{ top: 16, right: 12, bottom: 28, left: 56 }}
      >
        <Grid horizontal />
        <Area dataKey="revenueCents" stroke="var(--chart-1)" />
        <XAxis numTicks={5} />
        <YAxis formatValue={(v) => formatMoneyTick(v as number)} />
        <ChartTooltip
          rows={(point) => [
            {
              color: "var(--chart-1)",
              label: "Received",
              value: formatMoneyExact(point.revenueCents as number),
            },
          ]}
        />
      </AreaChart>
    </SousChart>
  );
}

function NetProfitLossLine({ state }: { state: ChartDataState }) {
  const { label } = usePeriod();
  const { points, grain, sampleSize } = useRevenue(state);
  return (
    <SousChart
      title="Net, after all three layers"
      periodLabel={label}
      sampleSize={sampleSize}
      sampleNoun="days"
      grain={grain}
      state={state === "empty" ? "empty" : state === "single" ? "single" : "ready"}
      emptyTitle="Nothing to weigh yet"
      emptyBody="Once sales and costs both exist, the truth lives here."
      singleValue={points[0] ? formatMoneyExact(points[0].netCents) : undefined}
      singleLabel="Net so far"
    >
      <LineChart
        data={points}
        xDataKey="date"
        animationDuration={DURATION}
        yDomainTween={false}
        aspectRatio="2 / 1"
        margin={{ top: 16, right: 12, bottom: 28, left: 56 }}
      >
        <Grid horizontal />
        {/* Registers the series so the y-domain derives from the data; the
            visible stroke is the ProfitLossLine below. */}
        <Line dataKey="netCents" stroke="transparent" animate={false} />
        {/* Semantic, never brand: profit green above zero, loss red below. */}
        <ProfitLossLine
          dataKey="netCents"
          positiveColor="var(--chart-profit)"
          negativeColor="var(--chart-loss)"
        />
        <XAxis numTicks={5} />
        <YAxis formatValue={(v) => formatMoneyTick(v as number)} />
        <ChartTooltip
          rows={(point) => [
            {
              color:
                (point.netCents as number) >= 0
                  ? "var(--chart-profit)"
                  : "var(--chart-loss)",
              label: "Net",
              value: formatMoneyExact(point.netCents as number),
            },
          ]}
        />
      </LineChart>
    </SousChart>
  );
}

function OrdersBars({ state }: { state: ChartDataState }) {
  const { label } = usePeriod();
  const { points, grain, sampleSize } = useRevenue(state);
  // BarChart is categorical (scaleBand on xDataKey="name"): buckets become
  // short labels rather than Date.toString() band keys.
  const bars = React.useMemo(
    () =>
      points.map((p) => ({
        name: p.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        orders: p.orders,
      })),
    [points],
  );
  return (
    <SousChart
      title="Orders"
      periodLabel={label}
      sampleSize={sampleSize}
      sampleNoun="days"
      grain={grain}
      state={state === "empty" ? "empty" : state === "single" ? "single" : "ready"}
      emptyTitle="No orders yet"
      emptyBody="Orders land here and on the calendar."
      singleValue={points[0] ? formatCount(points[0].orders) : undefined}
      singleLabel="Orders so far"
    >
      <BarChart data={bars} animationDuration={DURATION} aspectRatio="2 / 1">
        <Bar dataKey="orders" fill="var(--chart-1)" />
        <BarXAxis />
        <ChartTooltip
          rows={(point) => [
            {
              color: "var(--chart-1)",
              label: "Orders",
              value: formatCount(point.orders as number),
            },
          ]}
        />
      </BarChart>
    </SousChart>
  );
}

function MarginByItemBars({ state }: { state: ChartDataState }) {
  const items =
    state === "empty" ? [] : state === "single" ? MENU_ITEMS.slice(0, 1) : MENU_ITEMS;
  return (
    <SousChart
      title="Gross margin by item"
      sampleSize={items.length}
      sampleNoun="menu items"
      state={state === "empty" ? "empty" : "ready"}
      emptyTitle="No menu items yet"
      emptyBody="Cost a menu item and its margin appears here."
    >
      {/* Mobile rule: labels truncate; the tooltip carries the full name. */}
      <BarChart
        data={[...items]}
        orientation="horizontal"
        animationDuration={DURATION}
        aspectRatio="2 / 1.4"
      >
        <Bar dataKey="marginPercent" fill="var(--chart-1)" />
        {/* Horizontal bars label on the y side; the tooltip carries the
            full name when 380px truncates it. */}
        <BarYAxis />
        <ChartTooltip
          rows={(point) => [
            {
              color: "var(--chart-1)",
              label: String(point.name),
              value: formatMarginTick(point.marginPercent as number),
            },
          ]}
        />
      </BarChart>
    </SousChart>
  );
}

function VarianceDivergingBars({ state }: { state: ChartDataState }) {
  const rows =
    state === "empty" ? [] : state === "single" ? VARIANCE_ROWS.slice(0, 1) : VARIANCE_ROWS;
  return (
    <SousChart
      title="Stocktake variance"
      sampleSize={rows.length}
      sampleNoun="ingredients"
      state={state === "empty" ? "empty" : "ready"}
      emptyTitle="No stocktake yet"
      emptyBody="Count the pantry once and variances appear here."
    >
      <BarChart data={[...rows]} animationDuration={DURATION} aspectRatio="2 / 1">
        {/* Diverging = signed values; over is quiet, short is the warning. */}
        <Bar dataKey="overCents" fill="var(--chart-profit)" />
        <Bar dataKey="shortCents" fill="var(--chart-warn)" />
        <BarXAxis />
        <ChartTooltip
          rows={(point) => {
            const over = point.overCents as number;
            const short = point.shortCents as number;
            return short > 0
              ? [
                  {
                    color: "var(--chart-warn)",
                    label: `${point.name} — short`,
                    // Negative money: red AND parenthesised in the formatter.
                    value: formatMoneyExact(-short),
                  },
                ]
              : [
                  {
                    color: "var(--chart-profit)",
                    label: `${point.name} — over`,
                    value: formatMoneyExact(over),
                  },
                ];
          }}
        />
      </BarChart>
    </SousChart>
  );
}

function PaidRing({ state }: { state: ChartDataState }) {
  const paid = 812_000;
  const total = 984_000;
  return (
    <SousChart
      title="Paid vs outstanding"
      sampleSize={state === "single" ? 1 : 37}
      sampleNoun="orders"
      state={state === "empty" ? "empty" : "ready"}
      emptyTitle="No invoices yet"
      emptyBody="Payment status appears with the first order."
    >
      {/* Own center overlay: the vendor RingCenter's resting state renders
          raw cents through NumberFlow — a money-format violation. */}
      <div className="relative mx-auto w-fit">
        <RingChart
          size={210}
          data={[
            {
              label: "Paid",
              value: state === "single" ? 3200 : paid,
              maxValue: state === "single" ? 3200 : total,
              color: "var(--chart-1)",
            },
          ]}
          animationDuration={DURATION}
        >
          <Ring index={0} />
        </RingChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="numeric-lg">
            {state === "single" ? "100%" : `${Math.round((paid / total) * 100)}%`}
          </span>
          <span className="type-caption text-muted-foreground">Paid</span>
        </div>
      </div>
      <p className="type-caption text-center text-muted-foreground">
        {state === "single"
          ? `${formatMoneyExact(3200)} of ${formatMoneyExact(3200)}`
          : `${formatMoneyExact(paid)} of ${formatMoneyExact(total)}`}
      </p>
    </SousChart>
  );
}

function MarginGauge({ state }: { state: ChartDataState }) {
  const value = state === "single" ? 41 : 58;
  return (
    <SousChart
      title="Average gross margin"
      sampleSize={state === "single" ? 1 : 37}
      sampleNoun="orders"
      state={state === "empty" ? "empty" : "ready"}
      emptyTitle="No margins yet"
      emptyBody="Costed sales feed this gauge."
    >
      <Gauge
        value={value}
        centerValue={value}
        suffix="%"
        defaultLabel="target 65%"
        activeFill="var(--chart-1)"
        totalNotches={40}
        enterTransition={{ type: "tween", duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
      />
      <p className="type-caption text-center text-muted-foreground">
        Target 65% — to hit it on the current mix you would need{" "}
        <span className="numeric">{formatMoneyExact(274)}</span> per unit.
      </p>
    </SousChart>
  );
}

function SensoryRadar({ state }: { state: ChartDataState }) {
  // No constant-50 target SERIES any more — <RadarMidline> draws it properly.
  // Keeping both would put a filled pentagon under a dashed outline.
  const series = state === "single" ? [] : [SENSORY_RATINGS];
  return (
    <SousChart
      title="Sensory profile — fudge cake"
      sampleSize={state === "single" ? 1 : 23}
      sampleNoun="ratings"
      state={state === "empty" ? "empty" : "ready"}
      emptyTitle="No feedback yet"
      emptyBody="Customer ratings sketch this shape."
    >
      <RadarChart
        data={series}
        metrics={SENSORY_METRICS}
        enterDurationMs={DURATION}
        size={300}
        className="mx-auto"
      >
        {/* The ring values are the chart's internal 0–100 domain, not her
            scale. On a sensory radar they read as measurements of nothing. */}
        <RadarGrid showLabels={false} />
        <RadarAxis />
        <RadarLabels />
        {/* An ACTUAL dashed midline. This caption has claimed one since the
            specimen shipped while the code drew a filled constant-50 polygon
            — geometrically right, visually a shaded ZONE, and a shaded zone on
            a diverging scale reads as "inside is fine" when inside means "not
            enough". */}
        <RadarMidline />
        {series.map((_, i) => (
          <RadarArea key={i} index={i} showPoints />
        ))}
      </RadarChart>
      <p className="type-caption text-center text-muted-foreground">
        The dashed midline is &ldquo;just right&rdquo; — 50 on every axis.
      </p>
    </SousChart>
  );
}

function ProductionHeatmap({ state }: { state: ChartDataState }) {
  const columns = heatmapColumns(state);
  return (
    <SousChart
      title="Production activity"
      sampleSize={columns.reduce((n, c) => n + c.bins.filter((b) => b.count > 0).length, 0)}
      sampleNoun="production days"
      grain="day"
      state={state === "empty" ? "empty" : "ready"}
      emptyTitle="Nothing baked yet"
      emptyBody="Production logs light this up, day by day."
      scrollMinWidth={560}
    >
      <HeatmapChart data={columns} animationDuration={DURATION} layout="fluid">
        <HeatmapCells />
        <HeatmapXAxis />
        <HeatmapYAxis />
        <HeatmapTooltip />
      </HeatmapChart>
    </SousChart>
  );
}

function MarginScatter({ state }: { state: ChartDataState }) {
  const points = scatterPoints(state);
  return (
    <SousChart
      title="Margin per order"
      sampleSize={points.length}
      sampleNoun="orders"
      state={state === "empty" ? "empty" : state === "single" ? "single" : "ready"}
      emptyTitle="No orders to place"
      emptyBody="Each order lands as a dot: when it happened, what it kept."
      singleValue={points[0] ? formatMarginTick(points[0].marginPercent) : undefined}
      singleLabel="Margin on the one order so far"
    >
      <ScatterChart data={points} xDataKey="date" animationDuration={DURATION} aspectRatio="2 / 1">
        <Grid horizontal />
        <Scatter dataKey="marginPercent" radius={5} />
        <XAxis numTicks={5} />
        <YAxis formatValue={(v) => formatMarginTick(v as number)} />
      </ScatterChart>
    </SousChart>
  );
}

function RevenueVsCostComposed({ state }: { state: ChartDataState }) {
  const { label } = usePeriod();
  const { points, grain, sampleSize } = useRevenue(state);
  return (
    <SousChart
      title="Revenue vs ingredient cost"
      periodLabel={label}
      sampleSize={sampleSize}
      sampleNoun="days"
      grain={grain}
      state={state === "empty" ? "empty" : state === "single" ? "single" : "ready"}
      emptyTitle="Nothing to compare yet"
      emptyBody="Sales and purchases meet here."
      singleValue={points[0] ? formatMoneyExact(points[0].revenueCents) : undefined}
      singleLabel="One day of revenue"
    >
      <ComposedChart data={points} xDataKey="date" aspectRatio="2 / 1">
        <Grid horizontal />
        <SeriesBar dataKey="revenueCents" fill="var(--chart-5)" />
        <Line dataKey="ingredientsCents" stroke="var(--chart-2)" />
        <XAxis numTicks={5} />
        <YAxis formatValue={(v) => formatMoneyTick(v as number)} />
        <ChartTooltip
          rows={(point) => [
            {
              color: "var(--chart-5)",
              label: "Revenue",
              value: formatMoneyExact(point.revenueCents as number),
            },
            {
              color: "var(--chart-2)",
              label: "Ingredients",
              value: formatMoneyExact(point.ingredientsCents as number),
            },
          ]}
        />
      </ComposedChart>
    </SousChart>
  );
}

function CostFlowSankey({ state }: { state: ChartDataState }) {
  return (
    <SousChart
      title="Where the money went"
      periodLabel="Last month"
      sampleSize={37}
      sampleNoun="orders"
      state={state === "empty" ? "empty" : "ready"}
      emptyTitle="No flows yet"
      emptyBody="Costs and revenue braid together here once both exist."
      scrollMinWidth={520}
    >
      <SankeyChart
        data={SANKEY_DATA}
        animationDuration={DURATION}
        aspectRatio="2 / 1.2"
        margin={{ left: 96, right: 96, top: 16, bottom: 16 }}
        nodeWidth={10}
        nodePadding={16}
      >
        <SankeyLink />
        {/* Inflow-only labels: sources would read "$0.00", and a false zero
            is worse than silence. */}
        <SankeyNode formatValueLabel={(v) => (v > 0 ? formatMoneyExact(v) : "")} />
        <SankeyTooltip />
      </SankeyChart>
    </SousChart>
  );
}

function MenuSunburst({ state }: { state: ChartDataState }) {
  return (
    <SousChart
      title="Revenue by menu corner"
      periodLabel="Last month"
      sampleSize={37}
      sampleNoun="orders"
      state={state === "empty" ? "empty" : "ready"}
      emptyTitle="No revenue to slice"
      emptyBody="Each ring is a category; each slice, an item."
    >
      {/* One segment per ARC, not per child. buildArcs flattens every node at
          depth >= 1 into one array — 8 for this fixture, not the 3 top-level
          children. Mapping over `children` rendered Cakes and its two leaves
          and silently dropped Bakes, Bread and everything under them. */}
      <SunburstChart data={SUNBURST_DATA} size={300} className="mx-auto">
        {Array.from({ length: buildArcs(SUNBURST_DATA).arcs.length }, (_, i) => (
          <SunburstSegment key={i} index={i} />
        ))}
        <SunburstCenter />
      </SunburstChart>
    </SousChart>
  );
}

// --- Page -----------------------------------------------------------------

const STATES: { key: ChartDataState; label: string }[] = [
  { key: "normal", label: "Normal" },
  { key: "empty", label: "Zero rows" },
  { key: "single", label: "One row" },
  { key: "dense", label: "800 rows" },
];

export default function ChartsReferencePage() {
  const [state, setState] = React.useState<ChartDataState>("normal");
  return (
    <PeriodProvider defaultPeriod="quarter">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 md:px-6 md:py-14">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="type-flourish text-primary" aria-hidden>
              Sous
            </p>
            <h1 className="type-display">Charts</h1>
            <p className="type-body max-w-2xl text-muted-foreground">
              Every chart Sous will draw, on Bklit, wearing the org palette —
              semantic colours never included. Later slices copy from here.
            </p>
          </div>
          <ModeToggle />
        </header>

        <div className="flex flex-col gap-3">
          <PaletteSwapper />
          <SemanticStrip />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodSwitcher />
          <Tabs value={state} onValueChange={(v) => setState(v as ChartDataState)}>
            <TabsList>
              {STATES.map(({ key, label }) => (
                <TabsTrigger key={key} value={key}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <RevenueLine state={state} />
          <CashArea state={state} />
          <NetProfitLossLine state={state} />
          <OrdersBars state={state} />
          <MarginByItemBars state={state} />
          <VarianceDivergingBars state={state} />
          <RevenueVsCostComposed state={state} />
          <MarginScatter state={state} />
          <ProductionHeatmap state={state} />
          <CostFlowSankey state={state} />
          <SensoryRadar state={state} />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <PaidRing state={state} />
            <MarginGauge state={state} />
          </div>
          <MenuSunburst state={state} />
        </div>

        <footer className="flex items-center gap-2 border-t pt-5">
          <CalendarDays aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.5} />
          <p className="type-caption text-muted-foreground">
            Mount animation runs once (≤260ms, staggered bars at 50ms); period
            and state switches never replay it. Brush is desktop-only — mobile
            gets the period switcher.
          </p>
        </footer>
      </main>
    </PeriodProvider>
  );
}
