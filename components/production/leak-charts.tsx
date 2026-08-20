"use client";

import { CookingPot } from "lucide-react";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { Area } from "@/components/charts/area";
import { AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ReferenceArea } from "@/components/charts/reference-area";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { formatMoneyExact } from "@/components/charts-sous/format";

/**
 * The leak, in three readings.
 *
 * Two of the three forms originally specified are not expressible in this
 * library, and reshaping them turned out to serve the point better than
 * fighting it would have:
 *
 * - A Composed chart with menu items on X cannot exist — every cartesian
 *   chart here is built on a time scale, and SeriesBar returns null in a
 *   categorical context. BarChart's scaleBand renders item names as
 *   themselves, and the GAP between made and sold is the message anyway.
 * - A 45° parity diagonal has no primitive: ReferenceArea emits a rect plus
 *   two horizontal edges, so a diagonal cannot be drawn at all. Plotting the
 *   VARIANCE instead makes distance-from-parity the y value itself, readable
 *   against a zero rule the library can draw — and it adds the dimension a
 *   scatter never had: whether she is getting better.
 */

const DURATION = 200;
/** Half a point either side, drawn as a band because there is no
 * ReferenceLine — the technique the pantry's zero rule already uses. */
const RULE_HALF_HEIGHT = 0.35;
/** DESIGN.md §5: no trend through fewer than eight points. */
const MIN_FOR_TREND = 8;

export interface MadeVsSoldRow {
  menuItemId: string;
  name: string;
  madeMilli: number;
  soldMilli: number;
  wastedMilli: number;
  onHandMilli: number;
  wastePercent: number;
  wasteValueCents: number;
}

export function MadeVersusSoldChart({ rows }: { rows: MadeVsSoldRow[] }) {
  const data = rows.slice(0, 8).map((r) => ({
    name: r.name,
    made: r.madeMilli / 1000,
    sold: r.soldMilli / 1000,
    wastedUnits: r.wastedMilli / 1000,
    onHandUnits: r.onHandMilli / 1000,
    wastePercent: r.wastePercent,
    wasteValueCents: r.wasteValueCents,
  }));

  return (
    <SousChart
      title="Made against sold"
      state={data.length === 0 ? "empty" : "ready"}
      emptyIcon={CookingPot}
      emptyTitle="No batches logged yet"
      emptyBody="Log what you make and this shows you the gap between what came out of the oven and what someone paid for."
      scrollMinWidth={data.length > 4 ? 420 : undefined}
      caption={
        <p className="type-caption text-center text-muted-foreground">
          The gap between the two bars is what nobody paid for — given away,
          binned, or still sitting on the shelf. Tap a pair for what it cost.
        </p>
      }
    >
      <BarChart
        data={data}
        animationDuration={DURATION}
        aspectRatio="2 / 1.3"
        margin={{ top: 16, right: 12, bottom: 28, left: 44 }}
      >
        <Bar dataKey="made" fill="var(--chart-1)" />
        <Bar dataKey="sold" fill="var(--chart-profit)" />
        <BarXAxis showAllLabels />
        {/* The cartesian YAxis, not BarYAxis — that one draws categories, and
            this library ships no numeric axis for bars. */}
        <YAxis numTicks={4} />
        <ChartTooltip
          showDatePill={false}
          rows={(point) => [
            {
              color: "var(--chart-1)",
              label: "Made",
              value: `${point.made as number}`,
            },
            {
              color: "var(--chart-profit)",
              label: "Sold",
              value: `${point.sold as number}`,
            },
            {
              color: "var(--chart-warn)",
              label: "Wasted",
              value: `${point.wastedUnits as number} · ${formatMoneyExact(
                point.wasteValueCents as number,
              )}`,
            },
            {
              color: "var(--chart-foreground-muted)",
              label: "Still on hand",
              value: `${point.onHandUnits as number}`,
            },
          ]}
        />
      </BarChart>
    </SousChart>
  );
}

export interface WastePoint extends Record<string, unknown> {
  date: Date;
  wastePercent: number;
}

export function WasteRateChart({ points }: { points: WastePoint[] }) {
  return (
    <SousChart
      title="How much goes to waste"
      sampleSize={points.length}
      sampleNoun="days with a batch"
      state={points.length === 0 ? "empty" : points.length === 1 ? "single" : "ready"}
      emptyIcon={CookingPot}
      emptyTitle="Nothing to trend yet"
      emptyBody="Once you have logged batches across a few days, the shape of your waste shows up here."
      singleValue={points[0] ? `${points[0].wastePercent}%` : undefined}
      singleLabel="wasted, on the one day logged"
    >
      <AreaChart
        data={points}
        animationDuration={DURATION}
        aspectRatio="2 / 1.2"
        margin={{ top: 16, right: 12, bottom: 28, left: 44 }}
      >
        <Grid horizontal />
        <Area
          dataKey="wastePercent"
          stroke="var(--chart-warn)"
          fill="var(--chart-warn)"
          fillOpacity={0.25}
        />
        <XAxis numTicks={5} />
        <YAxis numTicks={4} formatValue={(v) => `${Math.round(v)}%`} />
        <ChartTooltip
          rows={(point) => [
            {
              color: "var(--chart-warn)",
              label: "Wasted",
              value: `${point.wastePercent as number}%`,
            },
          ]}
        />
      </AreaChart>
    </SousChart>
  );
}

export interface VariancePoint extends Record<string, unknown> {
  date: Date;
  variancePercent: number;
  name: string;
  expectedUnits: number;
  actualUnits: number;
}

/**
 * Actual against expected, per batch — as variance over time.
 *
 * Every point below the rule is a batch that under-delivered, and how far
 * below is how much. That is precisely what a 45° diagonal encodes, except
 * that the distance is now the number itself rather than something the eye
 * has to measure against a line.
 */
export function YieldVarianceChart({ points }: { points: VariancePoint[] }) {
  const enough = points.length >= MIN_FOR_TREND;
  return (
    <SousChart
      title="What the recipe says, against what you got"
      sampleSize={points.length}
      sampleNoun="batches"
      state={points.length === 0 ? "empty" : "ready"}
      emptyIcon={CookingPot}
      emptyTitle="No batches yet"
      emptyBody="Every batch you log lands here, above or below what the recipe promised."
      caption={
        <p className="type-caption text-center text-muted-foreground">
          {enough
            ? "Zero is the recipe. Everything below it is a batch that came up short."
            : `Zero is the recipe. ${points.length} ${points.length === 1 ? "batch" : "batches"} so far — too few to call a trend, so none is drawn.`}
        </p>
      }
    >
      <AreaChart
        data={points}
        animationDuration={DURATION}
        aspectRatio="2 / 1.2"
        margin={{ top: 16, right: 12, bottom: 28, left: 44 }}
      >
        <Grid horizontal />
        {/* Parity. A band rather than a line because the library has none. */}
        <ReferenceArea
          y1={-RULE_HALF_HEIGHT}
          y2={RULE_HALF_HEIGHT}
          fill="var(--chart-target)"
          fillOpacity={1}
          stroke="var(--chart-target)"
          ifOverflow="visible"
        />
        <Area
          dataKey="variancePercent"
          stroke="var(--chart-1)"
          fillOpacity={0}
          showMarkers
          // Below eight batches the points are shown but never joined into a
          // claim about direction (DESIGN.md §5).
          showLine={enough}
        />
        <XAxis numTicks={5} />
        <YAxis numTicks={4} formatValue={(v) => `${Math.round(v)}%`} />
        <ChartTooltip
          rows={(point) => [
            {
              color: "var(--chart-1)",
              label: String(point.name),
              value: `${point.actualUnits as number} of ${point.expectedUnits as number}`,
            },
            {
              color:
                (point.variancePercent as number) < 0
                  ? "var(--chart-warn)"
                  : "var(--chart-profit)",
              label: "Against the recipe",
              value: `${(point.variancePercent as number) > 0 ? "+" : ""}${point.variancePercent as number}%`,
            },
          ]}
        />
      </AreaChart>
    </SousChart>
  );
}
