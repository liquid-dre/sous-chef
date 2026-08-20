"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { CostTooltip } from "@/components/charts-sous/cost-tooltip";

/**
 * The table of contents: every live recommendation, ranked by money.
 *
 * ONE chart on this screen, deliberately. This is a list of actions, not an
 * analysis surface — a wall of charts here would bury the actions it exists to
 * surface. The bars exist so she can see at a glance whether the top item is
 * twice the next one or barely ahead of it, which changes what she does with
 * her afternoon.
 *
 * It is NOT the tappable surface. `Bar` has no click handler anywhere in the
 * vendored charts — the same finding as the Sankey on Home — so the list
 * beneath repeats this ranking as real links, in the same order. That is the
 * version that works on a phone anyway, where there is no hover.
 *
 * One `<Bar>` and a scalar fill, because `Bar.fill` is a string and not a
 * function: the chart cannot colour a bar by its value. That is fine here —
 * every bar is money going the wrong way, so one colour is the honest one.
 */

/** Enough to see the shape without the labels collapsing at 380px. */
const MAX_BARS = 8;

/**
 * Height per bar, in px, plus the axis chrome.
 *
 * An aspect ratio is wrong for this chart and the browser proved it: at a
 * desktop width, "2 / 1.6" over eight bars produced a 542px plot — half a
 * screen of whitespace for what is meant to be a glanceable table of contents
 * above the list she actually came for. Height belongs to the number of rows,
 * not to the width of the window.
 *
 * BarChart sets `aspect-ratio` inline and offers no height prop, but CSS
 * ignores aspect-ratio when both dimensions are definite — so a sized wrapper
 * plus `h-full` wins without touching the vendored file.
 */
const BAR_PX = 40;
/** Only the top and bottom margins below — there is no X axis to leave room
 * for, and reserving 24px for one that is never rendered read as a gap under
 * the last bar. */
const CHROME_PX = 8;

/**
 * `Bar` staggers its entrance over a further 40% of the duration, so the last
 * bar finishes at duration × 1.4. 200ms keeps the whole run inside the 300ms
 * ceiling (emil: nothing over 300ms).
 */
const DURATION = 200;

export interface ImpactRow extends Record<string, unknown> {
  name: string;
  cents: number;
}

export function ImpactBars({
  rows,
  periodLabel,
}: {
  rows: ImpactRow[];
  periodLabel: string;
}) {
  const shown = rows.slice(0, MAX_BARS);
  const hidden = rows.length - shown.length;

  return (
    <SousChart
      title="Where the money is going"
      periodLabel={periodLabel}
      sampleSize={rows.length}
      sampleNoun={rows.length === 1 ? "recommendation" : "recommendations"}
      // Never `single`: SousChart's single-point copy is about TRENDS ("a trend
      // needs more days"), which is nonsense over a ranking — and a single bar
      // is a perfectly honest bar anyway. The chart simply is not rendered
      // below MIN_ROWS_FOR_BARS.
      state={shown.length === 0 ? "empty" : "ready"}
      emptyBody="Nothing is leaking right now."
      caption={
        hidden > 0 ? (
          // Never a silent truncation: a chart that stops at eight without
          // saying so reads as "these are all of them".
          <p className="type-caption text-muted-foreground">
            The {MAX_BARS} biggest. {hidden} smaller{" "}
            {hidden === 1 ? "one is" : "ones are"} in the list below.
          </p>
        ) : undefined
      }
    >
      <div style={{ height: shown.length * BAR_PX + CHROME_PX }}>
        <BarChart
          className="h-full"
          data={shown}
          xDataKey="name"
          orientation="horizontal"
          animationDuration={DURATION}
          margin={{ left: 116, right: 16, top: 4, bottom: 4 }}
        >
          <Bar dataKey="cents" fill="var(--chart-loss)" />
          <BarYAxis />
          <CostTooltip
            valueKey="cents"
            valueLabel="Impact"
            // The X here is a name, not a date — without this the tooltip
            // formats the band key as a date, which is nonsense on a name axis.
            header={(point) => String(point.name ?? "")}
          />
        </BarChart>
      </div>
    </SousChart>
  );
}
