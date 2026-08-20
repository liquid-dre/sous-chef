"use client";

import * as React from "react";
import { ScatterChart } from "@/components/charts/scatter-chart";
import { Scatter } from "@/components/charts/scatter";
import { ReferenceArea } from "@/components/charts/reference-area";
import { Grid } from "@/components/charts/grid";
import { YAxis } from "@/components/charts/y-axis";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { CostTooltip } from "@/components/charts-sous/cost-tooltip";
import { formatMoneyTick, formatMoneyExact } from "@/components/charts-sous/format";

/**
 * Volume against profit — the reframe this whole screen exists to deliver.
 *
 * The bottom-right quadrant is the point: high volume, low profit, her
 * bestseller funding nothing. It cannot be seen in any ranking, because it is
 * two axes by nature — which is the one case where shape genuinely beats
 * prose (DESIGN.md §5).
 *
 * THREE workarounds, all forced by the vendored chart, all deliberate:
 *
 * 1. **X is time-only.** `scatter-chart-shell.tsx` hard-codes
 *    `scaleTime` + `new Date(value)`; there is no `xScaleType` anywhere in the
 *    repo. Units are therefore encoded as milliseconds-since-epoch, which maps
 *    monotonically and positions correctly — and NO `<XAxis>` is rendered,
 *    because the axis would format the ticks as dates in 1970. The X axis is
 *    named in prose beneath instead.
 * 2. **The tooltip's date pill** is suppressed with `CostTooltip`'s `header`,
 *    which exists for exactly this.
 * 3. **Point size cannot be bound to a field** — `radius` is a scalar. So the
 *    production-hours dimension becomes three size buckets rendered as three
 *    `<Scatter>` series.
 *
 * And the quadrant dividers are `ReferenceArea` bands, not lines: the
 * primitive emits a rect plus two HORIZONTAL edges, so a vertical divider
 * does not exist, and a zero-width area returns null. A narrow zero-stroke
 * band is the only vertical mark the library can draw.
 */

export interface ScatterItem {
  menuItemId: string;
  name: string;
  unitsMilli: number;
  profitCents: number;
  productionMinutes: number;
}

interface Point extends Record<string, unknown> {
  /** Units, as epoch ms. See workaround 1. */
  date: number;
  /** For the tooltip and the y-domain. */
  profitCents: number;
  name: string;
  units: number;
  minutes: number;
}

/** Three buckets, because radius is a scalar and cannot vary per point. */
const BUCKETS = [
  { key: "light", radius: 4, label: "under an hour" },
  { key: "medium", radius: 7, label: "one to four hours" },
  { key: "heavy", radius: 11, label: "four hours or more" },
] as const;

/**
 * Terciles of the actual distribution, not fixed minute thresholds.
 *
 * `productionMinutes` is the time an item consumed across the whole PERIOD,
 * so its scale moves with the window — at 400 orders every item is thousands
 * of minutes and a fixed "under an hour / over four hours" ladder puts all of
 * them in the same bucket, which is a size encoding that encodes nothing.
 * Ranking against the other items is informative at any scale.
 */
function bucketsFor(minutes: number[]): (m: number) => number {
  const sorted = [...minutes].sort((a, b) => a - b);
  const at = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
  const low = at(1 / 3);
  const high = at(2 / 3);
  return (m) => (m <= low ? 0 : m <= high ? 1 : 2);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function VolumeProfitScatter({
  items,
  periodLabel,
}: {
  items: ScatterItem[];
  periodLabel: string;
}) {
  const { points, medians, span, ySpan } = React.useMemo(() => {
    // ONE data array with three degenerate value keys, because ScatterChart
    // takes a single `data` and each <Scatter> reads a dataKey out of it —
    // there is no per-series data prop. A point carries its profit under
    // exactly one bucket key and null under the other two, so each series
    // draws only its own points at its own radius. The same technique the
    // bars use for per-bar colour, for the same reason: the vendored props
    // are scalars.
    const bucketOf = bucketsFor(items.map((i) => i.productionMinutes));
    const rows: Point[] = items.map((i) => {
      const bucket = bucketOf(i.productionMinutes);
      return {
        date: i.unitsMilli / 1000,
        profitCents: i.profitCents,
        name: i.name,
        units: i.unitsMilli / 1000,
        minutes: i.productionMinutes,
        light: bucket === 0 ? i.profitCents : null,
        medium: bucket === 1 ? i.profitCents : null,
        heavy: bucket === 2 ? i.profitCents : null,
      };
    });
    const xs = rows.map((p) => p.date);
    const ys = rows.map((p) => p.profitCents);
    return {
      points: rows,
      medians: { x: median(xs), y: median(ys) },
      span: { min: Math.min(...xs, 0), max: Math.max(...xs, 1) },
      ySpan: { min: Math.min(...ys, 0), max: Math.max(...ys, 1) },
    };
  }, [items]);

  // Bands, not lines. Each is sized as a fraction of ITS OWN axis range — a
  // fixed 1-cent-tall band on an axis spanning hundreds of dollars is
  // sub-pixel and simply does not appear, which is how the horizontal divider
  // went missing the first time.
  const bandWidth = Math.max((span.max - span.min) / 240, 0.001);
  const bandHeight = Math.max((ySpan.max - ySpan.min) / 240, 0.5);

  return (
    <SousChart
      title="What sells against what earns"
      periodLabel={periodLabel}
      sampleSize={items.length}
      sampleNoun="items"
      state={items.length === 0 ? "empty" : items.length < 3 ? "single" : "ready"}
      emptyBody="Deliver a few different items and they spread out here."
      singleValue={items.length > 0 && items.length < 3 ? items[0].name : undefined}
      singleLabel="only one or two items so far"
      scrollMinWidth={480}
      caption="Left to right is units sold; up and down is profit. Bigger dots take longer to make."
    >
      <ScatterChart
        data={points}
        animationDuration={200}
        aspectRatio="2 / 1.3"
        margin={{ left: 8, right: 16, top: 12, bottom: 16 }}
      >
        <Grid />
        {/* The two dividers. Horizontal is a genuine band; vertical is a very
            narrow one with its strokes killed, which is the only way to mark
            an x position here. Both render UNDER the dots. */}
        <ReferenceArea
          y1={medians.y - bandHeight}
          y2={medians.y + bandHeight}
          fill="var(--chart-grid)"
          fillOpacity={0.5}
          strokeWidth={0}
          fadeEdges={false}
        />
        <ReferenceArea
          x1={medians.x - bandWidth}
          x2={medians.x + bandWidth}
          fill="var(--chart-grid)"
          fillOpacity={0.5}
          strokeWidth={0}
          fadeEdges={false}
        />
        {BUCKETS.map((bucket) => (
          <Scatter
            key={bucket.key}
            dataKey={bucket.key}
            radius={bucket.radius}
            fill="var(--chart-1)"
          />
        ))}
        {/* No <XAxis>: it would format units as dates. The axis is named in
            the caption instead. */}
        <YAxis formatValue={formatMoneyTick} />
        <CostTooltip
          valueKey="profitCents"
          valueLabel="Profit"
          header={(p) => String(p.name ?? "")}
          extraRows={(p) => [
            { label: "Units sold", value: String(p.units ?? 0) },
            { label: "Time to make", value: `${Math.round(Number(p.minutes ?? 0) / 60)}h` },
          ]}
        />
      </ScatterChart>
    </SousChart>
  );
}

/**
 * The quadrant named in words, under the chart.
 *
 * "Label that quadrant in plain words" — and on a phone, where a corner
 * annotation would be unreadable, the words ARE the label. It flags: two
 * facts and a name, and she decides.
 */
export function QuadrantNote({ items }: { items: ScatterItem[] }) {
  const note = React.useMemo(() => {
    if (items.length < 3) return null;
    const medUnits = median(items.map((i) => i.unitsMilli));
    const medProfit = median(items.map((i) => i.profitCents));
    const stuck = items
      .filter((i) => i.unitsMilli > medUnits && i.profitCents < medProfit)
      .sort((a, b) => b.unitsMilli - a.unitsMilli);
    return stuck[0] ?? null;
  }, [items]);

  if (!note) return null;
  return (
    <p className="type-body text-muted-foreground">
      Bottom right, selling hard and earning little:{" "}
      <span className="text-foreground">{note.name}</span> —{" "}
      <span className="numeric">{note.unitsMilli / 1000}</span> units for{" "}
      <span className="numeric">{formatMoneyExact(note.profitCents)}</span>.
    </p>
  );
}
