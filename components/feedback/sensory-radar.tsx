"use client";

import { RadarChart } from "@/components/charts/radar-chart";
import { RadarArea } from "@/components/charts/radar-area";
import { RadarAxis } from "@/components/charts/radar-axis";
import { RadarGrid } from "@/components/charts/radar-grid";
import { RadarLabels } from "@/components/charts/radar-labels";
import { RadarMidline } from "@/components/charts-sous/radar-midline";
import { AXIS_LABEL, type AxisSummary } from "@/convex/lib/feedback";

/**
 * The sensory profile: her item's shape against "just right".
 *
 * The one legitimate use of a radar — a small fixed set of comparable
 * dimensions where the SHAPE is the message. Every axis shares one scale and
 * one meaning, which is the condition a radar needs and almost never gets.
 *
 * What it draws is a MEAN, and a mean on a diverging scale collapses: four
 * people saying "far too sweet" and four saying "not sweet enough" land on the
 * midline and read as agreement. That is not a flaw to fix here — a polygon
 * needs one number per axis and there is no way around it — it is a reason
 * this chart is never shown alone. The proportion bars beneath it carry the
 * distribution, and `splitBothWays` marks the axes where the shape is lying.
 *
 * Suppressed below three axes: a two-axis radar is a line through the centre,
 * and a shape with no area cannot show a shape.
 */

/** Below this the polygon has no area and the chart says nothing. */
export const MIN_AXES_FOR_RADAR = 3;

export function SensoryRadar({
  axes,
  n,
  splitAxes,
}: {
  axes: AxisSummary[];
  n: number;
  /** Axes whose mean is hiding a two-sided split, named under the plot. */
  splitAxes: AxisSummary[];
}) {
  if (axes.length < MIN_AXES_FOR_RADAR) return null;

  const metrics = axes.map((a) => ({ key: a.axis, label: AXIS_LABEL[a.axis] }));
  const series = [
    {
      label: "Customers",
      color: "var(--chart-1)",
      values: Object.fromEntries(axes.map((a) => [a.axis, a.meanRadarValue])),
    },
  ];

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative">
        <RadarChart
          data={series}
          metrics={metrics}
          size={260}
          enterDurationMs={200}
          className="mx-auto"
        >
          {/* showLabels defaults to TRUE and prints the ring values — 20, 40,
              60, 80, 100. Those are the chart's internal domain, not anything
              on her scale, and the browser showed them sitting on a radar
              whose axis runs "far too little" to "far too much". A number
              that means nothing is worse than no number. */}
          <RadarGrid showLabels={false} />
          <RadarAxis />
          <RadarLabels />
          <RadarMidline />
          <RadarArea index={0} showPoints />
        </RadarChart>

        {/*
          n ON the chart, not in a caption below it — DESIGN.md is explicit
          that a claim's sample size travels with the claim. A DOM element
          rather than SVG text because `radar-chart.tsx:177` sets
          aria-hidden="true" on the whole SVG, so anything drawn inside it is
          invisible to a screen reader.
        */}
        <p className="type-caption absolute top-0 right-0 rounded-md bg-card/90 px-2 py-1 text-muted-foreground">
          n = <span className="numeric-sm">{n}</span>
          {n < 8 && <span className="ml-1">— too few to lean on</span>}
        </p>
      </div>

      <figcaption className="flex flex-col gap-1 text-center">
        <span className="type-caption text-muted-foreground">
          <span className="mr-1 inline-block h-px w-4 border-t-2 border-dashed border-muted-foreground align-middle" />
          Just right · the dashed line is your recipe as you wrote it
        </span>
        <span className="type-caption text-muted-foreground">
          Outside it, too much. Inside it, not enough.
        </span>
        {splitAxes.length > 0 && (
          // The radar cannot show this and must not pretend otherwise.
          <span className="type-caption text-foreground">
            {splitAxes.map((a) => a.label).join(" and ")}{" "}
            {splitAxes.length === 1 ? "sits" : "sit"} on the line because
            opinion is split, not because everyone agreed — see below.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
