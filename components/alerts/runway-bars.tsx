"use client";

import * as React from "react";
import { ShoppingBasket } from "lucide-react";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { CostTooltip } from "@/components/charts-sous/cost-tooltip";
import { StaleChartFrame, staleFill } from "./stale-chart";
import { formatQty, type BaseUnit } from "@/components/pantry/format";
import type { PantryTrust } from "@/convex/lib/alerts";

/**
 * What runs out first.
 *
 * The axis is DAYS OF COVER, and that is the one decision this chart rests
 * on. The scope asks for bars "measured in batches remaining" and for her
 * language on both sides — "milk: 1.5 batches left", "flour: 35 brownies
 * left". Those are different units, and you cannot sort 1.5 against 35 on one
 * axis. Days is the comparable scale, it sorts correctly, and it answers the
 * question the chart exists for: what runs out first, and when. Her phrase
 * rides in the label and the tooltip, where it needs no common denominator.
 *
 * SEVERITY IS IN THE BAR, not behind it. The scope asks for amber and red
 * thresholds as Reference Areas, and on a horizontal BarChart that is not
 * available: `bar-chart.tsx:294` collapses `yScales` to the VALUE scale whose
 * range is [0, innerWidth], so `y1`/`y2` would place a band using X pixels as
 * Y coordinates — and `x1`/`x2` throws outright on the non-callable fabricated
 * `xScale` at `bar-chart.tsx:357`. So the threshold is expressed by colouring
 * the bar itself, using the same degenerate-stacked-series technique
 * `solution-surface-chart.tsx` and the pantry drift chart already use: three
 * series, exactly one non-zero per row.
 *
 * Colour never carries it alone (DESIGN.md §4) — the category label wears a
 * mark, so the chart survives a greyscale WhatsApp screenshot.
 */

const DURATION = 200;

export interface RunwayRow {
  ingredientId: string;
  name: string;
  baseUnit: BaseUnit;
  onHandMilli: number;
  bookedMilli: number;
  daysOfCover: number | null;
  severity: "red" | "amber" | null;
  muted: boolean;
}

interface Row extends Record<string, unknown> {
  name: string;
  red: number;
  amber: number;
  fine: number;
  days: number;
  row: RunwayRow;
}

/** Marks compose rather than branch — a muted ingredient that is also short
 * must not lose one of its two marks. */
function label(row: RunwayRow): string {
  const marks = [
    row.severity === "red" ? "!" : row.severity === "amber" ? "⚠" : null,
    row.muted ? "muted" : null,
  ].filter(Boolean);
  return marks.length > 0 ? `${row.name} ${marks.join(" ")}` : row.name;
}

export function RunwayBars({
  rows,
  trust,
  daysSinceCount,
  className,
}: {
  rows: RunwayRow[];
  trust: PantryTrust;
  daysSinceCount: number | null;
  className?: string;
}) {
  const stale = trust !== "trusted";

  const data = React.useMemo<Row[]>(() => {
    return rows
      // A runway Sous cannot compute is not drawn as zero. An ingredient with
      // no booked demand and no history has an unknown runway, and a bar of
      // length nothing would read as "you have run out".
      .filter((r) => r.daysOfCover !== null)
      .map((r) => {
        const days = r.daysOfCover!;
        return {
          name: label(r),
          red: r.severity === "red" ? days : 0,
          amber: r.severity === "amber" ? days : 0,
          fine: r.severity === null ? days : 0,
          days,
          row: r,
        };
      });
  }, [rows]);

  const unknown = rows.length - data.length;

  return (
    <SousChart
      title="What runs out first"
      sampleSize={data.length}
      sampleNoun={data.length === 1 ? "ingredient" : "ingredients"}
      state={data.length === 0 ? "empty" : "ready"}
      emptyIcon={ShoppingBasket}
      emptyTitle="Nothing to measure yet"
      emptyBody="Take an order and log a shop, and Sous can work out how long each ingredient lasts."
      scrollMinWidth={data.length > 8 ? 380 : undefined}
      caption={
        <div className="flex flex-col gap-1">
          <p className="type-caption text-center text-muted-foreground">
            Days until each one runs out, soonest first — your booked orders
            first, then a normal week.{" "}
            <span className="whitespace-nowrap">! runs out</span> before your
            orders are covered;{" "}
            <span className="whitespace-nowrap">⚠ has under a week</span> spare.
          </p>
          {/* Never swallowed: a chart that hides how much it could not place
              invites her to read it as everything. */}
          {unknown > 0 && (
            <p className="type-caption text-center text-muted-foreground">
              <span className="numeric">{unknown}</span> more{" "}
              {unknown === 1 ? "ingredient is" : "ingredients are"} not here —
              nothing booked needs {unknown === 1 ? "it" : "them"} and there is
              no history yet to judge {unknown === 1 ? "it" : "them"} by.
            </p>
          )}
        </div>
      }
      className={className}
    >
      <StaleChartFrame stale={stale} daysSinceCount={daysSinceCount}>
        <BarChart
          data={data}
          xDataKey="name"
          orientation="horizontal"
          stacked
          animationDuration={DURATION}
          aspectRatio={data.length > 6 ? "2 / 1.6" : "2 / 1"}
          margin={{ left: 120, right: 16, top: 8, bottom: 24 }}
        >
          {/* Three series, one non-zero per row. Semantic tokens, never the
              org palette: a kitchen whose brand colour is red must not have
              "you run out on Thursday" render as brand chrome (DESIGN.md §5). */}
          <Bar dataKey="red" fill={staleFill("var(--chart-loss)", stale)} />
          <Bar dataKey="amber" fill={staleFill("var(--chart-warn)", stale)} />
          <Bar dataKey="fine" fill={staleFill("var(--chart-1)", stale)} />
          <BarYAxis />
          <CostTooltip
            valueKey="days"
            valueLabel="Days of cover"
            // The X here is a category, not a date — without this the tooltip
            // formats the band key as a date, which is nonsense on a name axis.
            header={(point) => String((point as Row).row?.name ?? point.name ?? "")}
            extraRows={(point) => {
              const r = (point as Row).row;
              if (!r) return [];
              const out = [
                { label: "On hand", value: formatQty(r.onHandMilli, r.baseUnit) },
              ];
              if (r.bookedMilli > 0) {
                out.push({
                  label: "Your orders need",
                  value: formatQty(r.bookedMilli, r.baseUnit),
                });
              }
              if (r.muted) out.push({ label: "Alerts", value: "muted" });
              return out;
            }}
          />
        </BarChart>
      </StaleChartFrame>
    </SousChart>
  );
}
