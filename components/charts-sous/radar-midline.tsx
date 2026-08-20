"use client";

import { useRadarStable } from "@/components/charts/radar-context";

/**
 * "Just right", drawn as a dashed outline on the radar.
 *
 * There is no reference primitive for a radar anywhere in the vendored charts.
 * `<ReferenceArea>` cannot be used here — it reads `useYScale` from
 * `chart-context`, and `RadarChart` provides only `RadarStableContext`, so it
 * throws. But `radar-chart.tsx:181-185` renders `{children}` verbatim and
 * unfiltered inside a Group centred at the radar's origin, which is the whole
 * opening this component needs.
 *
 * A POLYGON, not a circle, and the distinction is load-bearing. `radar-area`
 * connects its points with straight `L` segments, so an item rated exactly
 * "just right" on every axis draws a polygon. Against a circle it would touch
 * only at the vertices and appear deficient everywhere between them — a chart
 * that reports a fault in a perfect item. Tracing the same vertex geometry
 * means a perfect item overlays this line exactly, and every real deviation
 * reads as a bulge outward (too much) or a dent inward (not enough).
 *
 * Stroke only. The obvious alternative — a constant-50 series through
 * `RadarArea` — is geometrically identical but hard-codes `fillOpacity: 0.15`
 * with no way to turn it off, and a shaded "just right" ZONE is a lie on a
 * diverging scale: inside the shading means too little, which is exactly as
 * wrong as outside it, yet it reads as safe.
 */

/** 50 on the radar's hard-coded 0..100 domain — see `toRadarValue`. */
const MIDPOINT = 50;

export function RadarMidline({
  stroke = "var(--chart-target, var(--muted-foreground))",
}: {
  stroke?: string;
}) {
  const { metrics, getPointPosition } = useRadarStable();
  if (metrics.length < 3) return null;

  const d = `M ${metrics
    .map((_, index) => {
      const { x, y } = getPointPosition(index, MIDPOINT);
      return `${x},${y}`;
    })
    .join(" L ")} Z`;

  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={1.5}
      strokeDasharray="5 4"
      strokeLinejoin="round"
      opacity={0.75}
    />
  );
}
