"use client";

import * as React from "react";
import { LineChart } from "@/components/charts/line-chart";
import { Line } from "@/components/charts/line";
import { ProfitLossLine } from "@/components/charts/profit-loss-line";
import { ComposedChart } from "@/components/charts/composed-chart";
import { SeriesBar } from "@/components/charts/series-bar";
import { ReferenceArea } from "@/components/charts/reference-area";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { CostTooltip } from "@/components/charts-sous/cost-tooltip";
import {
  aggregateByGrain,
  type DayRow,
} from "@/components/charts-sous/aggregate";
import {
  formatMarginTick,
  formatMoneyTick,
} from "@/components/charts-sous/format";

/**
 * Profit over time, and revenue against cost.
 *
 * Both bucket their day-grain rows through `aggregateByGrain`, which picks the
 * coarsest necessary grain and reports it — 400 orders become weekly points
 * with the grain stated, never a smear pretending to be daily detail.
 *
 * Neither draws a trend below eight points (DESIGN.md §5). A line through
 * three deliveries is not a trend, it is three deliveries, and drawing it as
 * one is the failure this rule exists to stop.
 */

/** DESIGN.md §5: no trend through fewer than eight points. */
const MIN_TREND_POINTS = 8;

function useSeries(rows: DayRow[]) {
  return React.useMemo(() => aggregateByGrain(rows), [rows]);
}

export function ProfitOverTime({
  rows,
  periodLabel,
  targetNetMarginPercent,
}: {
  rows: DayRow[];
  periodLabel: string;
  targetNetMarginPercent: number | null;
}) {
  const { points, grain, sampleSize } = useSeries(rows);
  const enough = points.length >= MIN_TREND_POINTS;

  // The target as a MONEY band, because the Y axis is money: what profit would
  // have had to be, at each bucket's revenue, to hit the target. Drawn as a
  // band rather than a line because ReferenceArea is the only primitive there
  // is — it emits a rect and two horizontal edges, and there is no
  // ReferenceLine anywhere in the vendored charts.
  const band = React.useMemo(() => {
    if (targetNetMarginPercent == null || points.length === 0) return null;
    const targets = points.map(
      (p) => ((p.revenueCents ?? 0) * targetNetMarginPercent) / 100,
    );
    return {
      low: Math.min(...targets),
      high: Math.max(...targets),
    };
  }, [points, targetNetMarginPercent]);

  return (
    <SousChart
      title="Profit over time"
      periodLabel={periodLabel}
      sampleSize={sampleSize}
      sampleNoun="days"
      grain={grain}
      state={points.length === 0 ? "empty" : points.length === 1 ? "single" : "ready"}
      emptyBody="Deliver an order and profit starts drawing here."
      singleValue={
        points.length === 1
          ? formatMoneyTick(points[0].profitCents ?? 0)
          : undefined
      }
      singleLabel="one day so far"
      caption={
        enough
          ? band
            ? "The shaded band is what profit would have had to be to hit your target."
            : undefined
          : `Only ${points.length} ${points.length === 1 ? "point" : "points"} — too few to call a trend, so the line stays off.`
      }
    >
      <LineChart
        data={points}
        animationDuration={200}
        aspectRatio="2 / 1"
        // 52 on the left, not 8: a YAxis is portalled into a div sized by
        // margin.left, so a narrow margin leaves the tick labels nowhere to
        // render and the axis silently disappears. Same rule both sides.
        margin={{ left: 52, right: 16, top: 12, bottom: 34 }}
      >
        <Grid />
        {band && (
          <ReferenceArea
            y1={band.low}
            y2={band.high}
            fill="var(--chart-profit)"
            fillOpacity={0.08}
            stroke="var(--chart-profit)"
            strokeStyle="dashed"
            strokeWidth={1}
          />
        )}
        {/* Registers the series so the y-domain includes it; the visible
            stroke is ProfitLossLine, which colours above/below zero. */}
        <Line dataKey="profitCents" stroke="transparent" animate={false} />
        {enough && <ProfitLossLine dataKey="profitCents" />}
        <XAxis />
        <YAxis formatValue={formatMoneyTick} />
        <CostTooltip valueKey="profitCents" valueLabel="Profit" />
      </LineChart>
    </SousChart>
  );
}

export function RevenueVersusCost({
  rows,
  periodLabel,
}: {
  rows: DayRow[];
  periodLabel: string;
}) {
  const { points, grain, sampleSize } = useSeries(rows);
  const withMargin = React.useMemo(
    () =>
      points.map((p) => ({
        ...p,
        // Null, never 0, on a day with no revenue. A day that only carried
        // waste has no margin — and plotting it as 0% would drag the whole
        // right-hand scale down to meet a number that does not exist.
        marginPercent:
          (p.revenueCents ?? 0) > 0
            ? Math.round(((p.profitCents ?? 0) * 100) / (p.revenueCents ?? 1))
            : null,
      })),
    [points],
  );

  return (
    <SousChart
      title="What came in, what it cost"
      periodLabel={periodLabel}
      sampleSize={sampleSize}
      sampleNoun="days"
      grain={grain}
      state={points.length === 0 ? "empty" : points.length === 1 ? "single" : "ready"}
      emptyBody="Two bars and a margin line, once orders start landing."
      singleValue={
        points.length === 1 ? formatMoneyTick(points[0].revenueCents ?? 0) : undefined
      }
      singleLabel="one day so far"
      scrollMinWidth={480}
      caption="Bars are money on the left axis; the line is margin on the right."
    >
      <ComposedChart
        data={withMargin}
        animationDuration={200}
        aspectRatio="2 / 1"
        // Room on the right for the second axis — it is portalled into a div
        // sized by margin.right, so without this it has nowhere to render.
        // Both axes need room; see the note on the chart above.
        margin={{ left: 52, right: 52, top: 12, bottom: 34 }}
        barGap={2}
      >
        <Grid />
        <SeriesBar dataKey="revenueCents" fill="var(--chart-1)" />
        <SeriesBar dataKey="costCents" fill="var(--chart-2)" />
        {/* Margin on its own scale. This is the ONE dual-axis path the
            vendored charts support: SeriesBar has no yAxisId and the extractor
            drops it, so a bar can never leave the left scale — only a Line or
            an Area can. Two units on one chart is exactly what Composed is
            for, and this is the only shape of it that works. */}
        <Line
          dataKey="marginPercent"
          yAxisId="right"
          stroke="var(--chart-profit)"
        />
        <XAxis />
        <YAxis formatValue={formatMoneyTick} />
        <YAxis
          yAxisId="right"
          orientation="right"
          formatValue={formatMarginTick}
        />
        <CostTooltip valueKey="revenueCents" valueLabel="Revenue" />
      </ComposedChart>
    </SousChart>
  );
}
