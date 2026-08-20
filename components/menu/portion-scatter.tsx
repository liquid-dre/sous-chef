"use client";

import * as React from "react";
import { ScatterChart } from "@/components/charts/scatter-chart";
import { Scatter } from "@/components/charts/scatter";
import { Grid } from "@/components/charts/grid";
import { YAxis } from "@/components/charts/y-axis";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { CostTooltip } from "@/components/charts-sous/cost-tooltip";
import { formatMarginTick } from "@/components/charts-sous/format";
import type { PortionEvidence } from "@/convex/lib/portionEvidence";

/**
 * How often "too small" was said, against the size the tray was cut at.
 *
 * POINTS ONLY. No trend line, no regression, no R². At these sample sizes a
 * fitted line is a lie with a slope, and DESIGN.md forbids a trend through
 * fewer than eight points outright. The shape of a handful of dots is the
 * whole honest content: if the right-hand dots sit higher, cutting finer drew
 * more complaints, and she can see that without a coefficient.
 *
 * THREE workarounds, all forced by the vendored chart, all the same ones
 * components/dashboard/volume-profit-scatter.tsx already documents:
 *
 * 1. **X is time-only.** `scatter-chart-shell.tsx` hard-codes `scaleTime` and
 *    coerces every value through `new Date()`; there is no `xScaleType`
 *    anywhere in the repo. Units per tray are therefore encoded as
 *    milliseconds-since-epoch, which maps monotonically and positions
 *    correctly — and NO `<XAxis>` is rendered, because it would print the
 *    ticks as dates in 1970. The axis is named in prose beneath.
 * 2. **The tooltip's date pill** is suppressed with `CostTooltip`'s `header`.
 * 3. **Point size cannot be bound to a field** — `radius` is a scalar, not an
 *    accessor — so sample size becomes three size buckets rendered as three
 *    `<Scatter>` series over one data array with degenerate keys.
 */

/** Below this there is no correlation to look at — one yield is a fact about
 * one number, and two dots do not make a relationship either. The chart is not
 * rendered at all rather than drawn and disclaimed. */
export const MIN_YIELDS_FOR_SCATTER = 2;

/** Three buckets, because radius is a scalar and cannot vary per point. */
const BUCKETS = [
  { key: "few", radius: 4, label: "1–2 ratings" },
  { key: "some", radius: 7, label: "3–5 ratings" },
  { key: "many", radius: 11, label: "6 or more" },
] as const;

interface Point extends Record<string, unknown> {
  /** Units per tray, as epoch ms. See workaround 1. */
  date: number;
  complaintPercent: number;
  yieldUnits: number;
  saidTooSmall: number;
  n: number;
  few: number | null;
  some: number | null;
  many: number | null;
}

function bucketOf(n: number): 0 | 1 | 2 {
  if (n >= 6) return 2;
  if (n >= 3) return 1;
  return 0;
}

export function PortionScatter({ evidence }: { evidence: PortionEvidence }) {
  const points = React.useMemo<Point[]>(() => {
    return evidence.byYield.map((row) => {
      const complaintPercent = Math.round((row.saidTooSmall * 100) / row.n);
      const bucket = bucketOf(row.n);
      return {
        date: row.yieldUnits,
        complaintPercent,
        yieldUnits: row.yieldUnits,
        saidTooSmall: row.saidTooSmall,
        n: row.n,
        few: bucket === 0 ? complaintPercent : null,
        some: bucket === 1 ? complaintPercent : null,
        many: bucket === 2 ? complaintPercent : null,
      };
    });
  }, [evidence]);

  const traced = evidence.byYield.reduce((sum, r) => sum + r.n, 0);

  return (
    <SousChart
      title="Size against complaints"
      sampleSize={traced}
      sampleNoun="traced ratings"
      state={points.length < MIN_YIELDS_FOR_SCATTER ? "empty" : "ready"}
      emptyTitle="Only one size so far"
      emptyBody="Cut a tray differently and log the batch, and the two sizes appear here side by side."
      caption={
        <div className="flex flex-col gap-1">
          <p className="type-caption text-center text-muted-foreground">
            Left to right is units per tray; up and down is how often somebody
            called it too small. Bigger dots rest on more ratings.
          </p>
          {/* Never swallowed. A chart that hides how much of the evidence it
              could place invites her to read it as all of it. */}
          {evidence.untraceable > 0 && (
            <p className="type-caption text-center text-muted-foreground">
              <span className="numeric">{evidence.untraceable}</span> more{" "}
              {evidence.untraceable === 1 ? "rating is" : "ratings are"} not
              here — no single batch could be matched to{" "}
              {evidence.untraceable === 1 ? "it" : "them"}.
            </p>
          )}
          <p className="type-caption text-center text-muted-foreground">
            Dots only, deliberately: a line through this few points would show
            a slope Sous cannot stand behind.
          </p>
        </div>
      }
    >
      <ScatterChart
        data={points}
        animationDuration={200}
        aspectRatio="2 / 1.3"
        margin={{ left: 44, right: 16, top: 12, bottom: 16 }}
      >
        <Grid horizontal />
        {BUCKETS.map((bucket) => (
          <Scatter
            key={bucket.key}
            dataKey={bucket.key}
            radius={bucket.radius}
            fill="var(--chart-warn)"
          />
        ))}
        {/* No <XAxis>: it would format units per tray as dates. Named in the
            caption instead. */}
        <YAxis formatValue={formatMarginTick} />
        <CostTooltip
          valueKey="complaintPercent"
          valueLabel="Said too small"
          // The X here is a yield, not a date — without this the tooltip
          // formats the epoch-encoded value as one.
          header={(p) => `${p.yieldUnits} a tray`}
          extraRows={(p) => [
            {
              label: "Said too small",
              value: `${p.saidTooSmall} of ${p.n}`,
            },
          ]}
        />
      </ScatterChart>
    </SousChart>
  );
}
