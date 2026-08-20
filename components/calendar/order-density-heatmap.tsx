"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import {
  HeatmapCells,
  HeatmapChart,
  HeatmapTooltip,
  HeatmapXAxis,
  HeatmapYAxis,
} from "@/components/charts/heatmap";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { formatDay } from "@/lib/day";

/**
 * Her rhythm: which days are heavy and which are dead.
 *
 * The first Heatmap in the product — it existed in the vendored charts and in
 * `app/design-system/charts/page.tsx` and nowhere else. It earns its place
 * here because the insight genuinely is a shape: "Fridays heavy, Tuesdays
 * dead" is a pattern across two axes at once, and no sentence carries that as
 * fast as a grid does.
 *
 * It is directly actionable in two places, which is the test DESIGN.md §5
 * sets for a chart existing at all: when to schedule production, and which
 * day the recurring "taking orders" message should go out.
 *
 * MOBILE: `scrollMinWidth` rather than shrinking. `sous-chart.tsx:17-18`
 * states the rule — cells never shrink below tap size, the container scrolls
 * instead. A twelve-week grid at 375px would give roughly 25px cells, which
 * is unreadable and untappable at once.
 *
 * MONDAY-FIRST, matching `windowFor` and `lib/period.ts:43`, which is why the
 * rows are labelled explicitly rather than left to the component's
 * GitHub-style Sunday default.
 */

/** A twelve-week grid is about 560px at a comfortable cell size. Below that
 * the container scrolls. */
const SCROLL_MIN = 560;

export interface DensityColumn {
  bin: number;
  bins: { bin: number; day: string; count: number }[];
}

export function OrderDensityHeatmap({
  columns,
  orderCount,
}: {
  columns: DensityColumn[];
  orderCount: number;
}) {
  // The vendored chart wants a real `Date` per bin; the server speaks domain
  // days. Converted at the edge, the way every other chart in Sous does it.
  const data = React.useMemo(
    () =>
      columns.map((c) => ({
        bin: c.bin,
        bins: c.bins.map((b) => {
          const [y, m, d] = b.day.split("-").map(Number);
          return { bin: b.bin, count: b.count, date: new Date(y, m - 1, d) };
        }),
      })),
    [columns],
  );

  const busiest = React.useMemo(() => {
    const byWeekday = new Array(7).fill(0);
    for (const c of columns) for (const b of c.bins) byWeekday[b.bin] += b.count;
    const max = Math.max(...byWeekday);
    if (max === 0) return null;
    const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    return names[byWeekday.indexOf(max)];
  }, [columns]);

  return (
    <SousChart
      title="When your orders land"
      sampleSize={orderCount}
      sampleNoun="orders"
      grain="day"
      state={orderCount === 0 ? "empty" : "ready"}
      emptyIcon={CalendarDays}
      emptyTitle="No orders yet"
      emptyBody="Once orders start landing, this shows which days of the week are busy and which are quiet."
      scrollMinWidth={SCROLL_MIN}
      caption={
        <p className="type-caption text-center text-pretty text-muted-foreground">
          Each square is a day; darker is more orders. Rows are Monday at the
          top through Sunday.
          {busiest && (
            <>
              {" "}
              Most of your orders land on a{" "}
              <span className="whitespace-nowrap">{busiest}</span>.
            </>
          )}
        </p>
      }
    >
      <HeatmapChart data={data} layout="fluid" weekStartDay={1} animationDuration={200}>
        <HeatmapCells />
        <HeatmapXAxis />
        {/* Every row labelled, not the default every-other — with only seven
            rows there is room, and "is that Wednesday or Thursday" is exactly
            the question this chart exists to answer. */}
        <HeatmapYAxis tickFilter="all" labelFormat="initial" />
        <HeatmapTooltip
          formatLabel={(count, date) => {
            const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            return `${count} ${count === 1 ? "order" : "orders"} · ${formatDay(day)}`;
          }}
        />
      </HeatmapChart>
    </SousChart>
  );
}
