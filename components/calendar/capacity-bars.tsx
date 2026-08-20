"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ReferenceArea } from "@/components/charts/reference-area";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { CostTooltip } from "@/components/charts-sous/cost-tooltip";
import { formatDay } from "@/lib/day";
import type { CapacityDay } from "./types";

/**
 * Scheduled baking hours per day, against the day she says she has.
 *
 * THE CEILING IS A DEGENERATE ReferenceArea, not a line. There is no
 * `ReferenceLine` in the vendored charts — three separate files carry
 * comments saying so — and the substitute is a band half a unit either side
 * of the value, the idiom `solution-surface-chart.tsx:188-199` and
 * `leak-charts.tsx:213-220` already use.
 *
 * VERTICAL, and that is forced rather than chosen. On a horizontal BarChart
 * the ceiling would run vertically and need `x1`/`x2`, which throws on the
 * non-callable fabricated xScale at `bar-chart.tsx:357`. Vertical puts the
 * ceiling on `y1`/`y2`, which works.
 *
 * `ifOverflow="visible"` because the rule sits ABOVE every bar on exactly the
 * days when nothing is over capacity — which is most days, and is when a
 * disappearing ceiling would be most confusing.
 *
 * FLAGS, NEVER BLOCKS. The over-capacity bars wear the warn token and the
 * caption names the ceiling, and that is the whole intervention. Sous does not
 * know she has help on Fridays.
 */

const DURATION = 200;
/** Half an hour either side, so the band reads as a rule rather than a zone.
 * The same trick and roughly the same proportion the other three use. */
const RULE_HALF_HEIGHT = 0.15;

interface Row extends Record<string, unknown> {
  name: string;
  under: number;
  over: number;
  hours: number;
  day: string;
}

export function CapacityBars({
  byDay,
  ceilingHours,
}: {
  byDay: CapacityDay[];
  ceilingHours: number;
}) {
  const rows = React.useMemo<Row[]>(
    () =>
      byDay.map((d) => ({
        // Short label: the axis has seven of these at 375px.
        name: formatDay(d.day).split(",")[0],
        // Two degenerate series, one non-zero per row — `Bar.fill` is a
        // string and not a function, so a per-bar tone can only be had this
        // way. The same technique the solution surface and the pantry drift
        // chart use.
        under: d.over ? 0 : d.hours,
        over: d.over ? d.hours : 0,
        hours: d.hours,
        day: d.day,
      })),
    [byDay],
  );

  const overCount = byDay.filter((d) => d.over).length;

  return (
    <SousChart
      title="Hours you have scheduled"
      sampleSize={byDay.length}
      sampleNoun={byDay.length === 1 ? "day" : "days"}
      state={rows.length === 0 ? "empty" : "ready"}
      emptyIcon={Clock}
      emptyTitle="Nothing scheduled"
      emptyBody="Once orders need baking, this shows how many hours each day asks of you."
      scrollMinWidth={rows.length > 5 ? 420 : undefined}
      caption={
        <p className="type-caption text-center text-pretty text-muted-foreground">
          The rule is your <span className="numeric">{ceilingHours}</span>-hour
          day.{" "}
          {overCount === 0
            ? "Nothing is over it."
            : `${overCount} ${overCount === 1 ? "day is" : "days are"} over — Sous is flagging it, not stopping you.`}{" "}
          You can change the figure in Settings.
        </p>
      }
    >
      <BarChart
        data={rows}
        stacked
        animationDuration={DURATION}
        aspectRatio="2 / 1.2"
        margin={{ top: 16, right: 12, bottom: 28, left: 40 }}
      >
        {/* ReferenceArea has no label prop, so the ceiling is named in the
            caption — where every other chart in Sous puts its key. */}
        <ReferenceArea
          y1={ceilingHours - RULE_HALF_HEIGHT}
          y2={ceilingHours + RULE_HALF_HEIGHT}
          fill="var(--chart-target)"
          fillOpacity={1}
          stroke="var(--chart-target)"
          ifOverflow="visible"
        />
        <Bar dataKey="under" fill="var(--chart-1)" />
        {/* Amber is the semantic warn token, never derived from her palette:
            a day over her own ceiling is a warning, not brand chrome
            (DESIGN.md §5). */}
        <Bar dataKey="over" fill="var(--chart-warn)" />
        <BarXAxis showAllLabels />
        {/* The cartesian YAxis, not BarYAxis: on a vertical bar chart
            BarYAxis draws the CATEGORY labels, and this library ships no
            numeric axis for bars. */}
        <YAxis numTicks={4} formatValue={(v) => `${Math.round(v)}h`} />
        <CostTooltip
          valueKey="hours"
          valueLabel="Scheduled"
          header={(point) => formatDay(String((point as Row).day ?? ""))}
          extraRows={(point) => [
            { label: "Your day", value: `${ceilingHours} h` },
            ...((point as Row).over > 0
              ? [{ label: "Over by", value: `${Math.round(((point as Row).hours - ceilingHours) * 10) / 10} h` }]
              : []),
          ]}
        />
      </BarChart>
    </SousChart>
  );
}
