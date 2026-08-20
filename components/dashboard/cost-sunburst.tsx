"use client";

import * as React from "react";
import { SunburstChart } from "@/components/charts/sunburst-chart";
import { SunburstSegment } from "@/components/charts/sunburst-segment";
import { SunburstCenter } from "@/components/charts/sunburst-center";
import { buildArcs } from "@/components/charts/sunburst";
import type { SunburstNode } from "@/components/charts/sunburst-data";
import { SousChart } from "@/components/charts-sous/sous-chart";

/**
 * The cost layers, drilled. Hierarchical data, hierarchical chart.
 *
 * Inner ring: ingredients, packaging, time & power, waste, delivery. Outer
 * ring: which product ate each of the two per-unit layers. Tapping an inner
 * arc zooms it — the vendored chart wires that itself and does not accept an
 * onClick of ours, so `onFocusChange` is the only hook there is.
 *
 * ONE SEGMENT PER ARC, not per child. `buildArcs` flattens every node at
 * depth ≥ 1 into one array — for a five-branch tree with items under two of
 * them that is far more than five. Mapping over `data.children` (as
 * app/design-system/charts/page.tsx did, silently drawing 3 of its 8 arcs)
 * renders the first few and drops the rest without a warning. This is the
 * trap that bug was hiding.
 */
export function CostSunburst({
  data,
  periodLabel,
  orderCount,
}: {
  data: SunburstNode;
  periodLabel: string;
  orderCount: number;
}) {
  // The same flattening the chart does internally, so the segment count is
  // derived from the data rather than guessed at.
  const arcCount = React.useMemo(
    () => (data.children?.length ? buildArcs(data).arcs.length : 0),
    [data],
  );

  return (
    <SousChart
      title="What the money was spent on"
      periodLabel={periodLabel}
      sampleSize={orderCount}
      sampleNoun="orders"
      state={arcCount === 0 ? "empty" : "ready"}
      emptyTitle="Nothing spent yet"
      emptyBody="Once orders are delivered, this breaks their cost into layers."
      caption="Tap a ring to open it. The outer ring shows which product each layer went on."
    >
      <SunburstChart data={data} size={300} className="mx-auto">
        {Array.from({ length: arcCount }, (_, i) => (
          <SunburstSegment key={i} index={i} />
        ))}
        <SunburstCenter />
      </SunburstChart>
    </SousChart>
  );
}
