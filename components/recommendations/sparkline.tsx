"use client";

import { curveMonotoneX } from "@visx/curve";
import { LineChart } from "@/components/charts/line-chart";
import { Line } from "@/components/charts/line";

/**
 * A chart only where trend IS the argument.
 *
 * Two cards get one. A drift card is making a claim about a direction — what
 * you paid, over time — and the line is the evidence for it. A dormant card is
 * making a claim about something stopping, and the line is where it stopped.
 * Every other card here argues a single number, and a chart of a single number
 * is decoration on a screen whose whole job is to be a list of actions.
 *
 * No axes, no grid, no tooltip: at this size they would be unreadable, and the
 * card's own words carry the figures. The line is shape, not measurement.
 *
 * The engine has already refused to hand over fewer than eight points
 * (DESIGN.md §5), so nothing here has to decide whether the shape means
 * anything — by the time it arrives, that is settled.
 */

/**
 * Sparkline-scale, and a FIXED height rather than an aspect ratio.
 *
 * An aspect ratio would make this 42px on her phone and 85px on a laptop — the
 * same line arguing twice as loudly on the bigger screen, which is backwards.
 * A sparkline is a fixed physical size by definition.
 */
const HEIGHT_PX = 44;

export function Sparkline({
  points,
  label,
}: {
  points: { date: string; value: number }[];
  label: string;
}) {
  return (
    <figure className="flex flex-col gap-1 overflow-hidden">
      <figcaption className="type-caption text-muted-foreground">{label}</figcaption>
      <div style={{ height: HEIGHT_PX }}>
        <LineChart
          className="h-full"
          data={points}
          xDataKey="date"
          // Zero margin: there are no axes to leave room for, and every pixel
          // spent on padding is one the shape does not get.
          margin={{ left: 0, right: 0, top: 4, bottom: 4 }}
          animationDuration={200}
        >
          <Line
            dataKey="value"
            stroke="var(--chart-loss)"
            strokeWidth={1.5}
            showHighlight={false}
            // Monotone, NOT the default curveNatural. Natural is a cubic
            // spline through every point and it overshoots hard on the shape
            // this chart exists to draw — weekly sales dropping to a flat run
            // of zeroes. In the browser it looped below the axis and back,
            // inventing weeks of negative sales. Monotone cannot leave the
            // interval between two points.
            curve={curveMonotoneX}
            // The fade reads as the data trailing off, which is the one thing
            // this line must not imply on a card about something stopping.
            fadeEdges={false}
          />
        </LineChart>
      </div>
    </figure>
  );
}
