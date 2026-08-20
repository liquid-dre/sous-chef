"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { CostTooltip } from "@/components/charts-sous/cost-tooltip";

/**
 * A sorted horizontal bar chart, which is what every ranking on this screen
 * is. Never a pie: a twelve-item menu as a pie is a colour wheel where 8% and
 * 11% are indistinguishable (DESIGN.md §5).
 *
 * Two `<Bar>` series rather than one, because `Bar.fill` is a string and not a
 * function — the vendored chart cannot colour a bar by its value. Splitting
 * the signed figure into two mutually exclusive fields and rendering one
 * series per colour is the technique the charts specimen already proves, and
 * it is what lets a loss read as a loss.
 */

export interface RankedRow extends Record<string, unknown> {
  name: string;
  /** Positive part; zero when the value is negative. */
  positiveCents: number;
  /** Negative part as a POSITIVE magnitude; zero when the value is positive. */
  negativeCents: number;
}

/** Split a signed figure into the two fields the two series read. */
export function splitSigned(name: string, cents: number): RankedRow {
  return {
    name,
    positiveCents: cents > 0 ? cents : 0,
    negativeCents: cents < 0 ? -cents : 0,
  };
}

export function RankedBars({
  title,
  periodLabel,
  rows,
  sampleSize,
  sampleNoun,
  caption,
  emptyBody,
  formatValue,
  valueLabel = "Profit",
  positiveFill = "var(--chart-profit)",
  negativeFill = "var(--chart-loss)",
}: {
  title: string;
  periodLabel: string;
  rows: RankedRow[];
  sampleSize: number;
  sampleNoun: string;
  caption?: string;
  emptyBody: string;
  formatValue: (cents: number) => string;
  /**
   * What the tooltip calls the number. Defaults to "Profit" because that is
   * what every caller until now was measuring — but an occasion mix counts
   * ORDERS, and a tooltip reading "Profit: 12" against a count is a lie
   * about the unit.
   */
  valueLabel?: string;
  /**
   * Bar tones. The profit/loss pair is the right default and the wrong one
   * for a count: a figure that cannot go negative rendered in `--chart-profit`
   * claims a good/bad reading the data does not carry. Semantic tokens only
   * either way, never the org palette (DESIGN.md §5).
   */
  positiveFill?: string;
  negativeFill?: string;
}) {
  return (
    <SousChart
      title={title}
      periodLabel={periodLabel}
      sampleSize={sampleSize}
      sampleNoun={sampleNoun}
      state={rows.length === 0 ? "empty" : rows.length === 1 ? "single" : "ready"}
      emptyBody={emptyBody}
      singleValue={
        rows.length === 1
          ? formatValue(rows[0].positiveCents - rows[0].negativeCents)
          : undefined
      }
      singleLabel={rows.length === 1 ? rows[0].name : undefined}
      caption={caption}
    >
      <BarChart
        data={rows}
        xDataKey="name"
        orientation="horizontal"
        animationDuration={200}
        aspectRatio={rows.length > 6 ? "2 / 1.6" : "2 / 1"}
        margin={{ left: 120, right: 16, top: 8, bottom: 24 }}
      >
        <Bar dataKey="positiveCents" fill={positiveFill} />
        <Bar dataKey="negativeCents" fill={negativeFill} />
        <BarYAxis />
        <CostTooltip
          valueKey="positiveCents"
          valueLabel={valueLabel}
          // The X here is a category, not a date — without this the tooltip
          // formats the band key as a date, which is nonsense on a name axis.
          header={(point) => String(point.name ?? "")}
        />
      </BarChart>
    </SousChart>
  );
}
