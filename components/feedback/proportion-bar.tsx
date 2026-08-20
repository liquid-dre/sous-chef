"use client";

import { AXIS_SCALE, type AxisSummary } from "@/convex/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * The rating distribution, diverging about a shared centre.
 *
 * NOT a chart, and deliberately so. `BarChart` cannot draw this: it hard-codes
 * `domain: [0, maxValue * 1.1]` and `x = 0` in its horizontal branch, excludes
 * negatives from its max computation entirely, and its stacking sums signed
 * values — so a diverging bar is not a configuration of it, it is a different
 * chart. This is a proportion bar in the family of a progress bar: five
 * segments, fixed order, no scales and no axes.
 *
 * The geometry is the argument. Every row's "just right" segment is centred on
 * ONE shared rule, so the rows can be read down a column: an axis that leans
 * right is one everyone agrees is too much, and an axis with weight on both
 * sides is one where her batches are inconsistent. Those are opposite fixes,
 * and a single averaged magnitude cannot tell them apart — which is the entire
 * reason this component exists rather than a number.
 *
 * Sample size sits ON the row, per DESIGN.md: n = 3 is not a trend and must
 * never be read as one because the caption was somewhere else.
 */

/** Half of "just right" falls each side, so the centre rule bisects it. */
const CENTRE = 2;

export function ProportionBar({
  summary,
  className,
}: {
  summary: AxisSummary;
  className?: string;
}) {
  const labels = AXIS_SCALE[summary.axis];
  const { counts, n } = summary;

  // Widths as a share of the widest possible SIDE, not of n — otherwise a row
  // where everyone agreed and a row where nobody did would be the same length
  // and the shape would say nothing.
  const leftUnits = counts[0] + counts[1] + counts[CENTRE] / 2;
  const rightUnits = counts[3] + counts[4] + counts[CENTRE] / 2;
  const span = Math.max(leftUnits, rightUnits, 1);
  /** Percent of the half-width. */
  const share = (value: number) => (value / span) * 100;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-label">{summary.label}</span>
        <span className="type-caption text-muted-foreground">
          n = <span className="numeric-sm">{n}</span>
        </span>
      </div>

      {n === 0 ? (
        <div className="flex h-6 items-center">
          <div className="h-px flex-1 bg-border" />
          <span className="type-caption px-2 text-muted-foreground">
            Nobody has said yet
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      ) : (
        <div
          className="relative flex h-6 items-stretch"
          role="img"
          aria-label={summary.sentence}
        >
          {/* Left half: too little, growing leftward from the centre. */}
          <div className="flex flex-1 items-stretch justify-end">
            <Segment
              width={share(counts[0])}
              tone="strong"
              title={`${counts[0]} · ${labels[0]}`}
            />
            <Segment
              width={share(counts[1])}
              tone="soft"
              title={`${counts[1]} · ${labels[1]}`}
            />
            <Segment
              width={share(counts[CENTRE] / 2)}
              tone="neutral"
              title={`${counts[CENTRE]} · ${labels[CENTRE]}`}
              rounded="none"
            />
          </div>

          {/* The rule every row shares. Absolutely centred so a column of rows
              is comparable without reading a single number. */}
          <div
            aria-hidden
            className="absolute inset-y-[-2px] left-1/2 w-px -translate-x-1/2 bg-foreground/40"
          />

          {/* Right half: too much, growing rightward. */}
          <div className="flex flex-1 items-stretch justify-start">
            <Segment
              width={share(counts[CENTRE] / 2)}
              tone="neutral"
              title={`${counts[CENTRE]} · ${labels[CENTRE]}`}
              rounded="none"
            />
            <Segment
              width={share(counts[3])}
              tone="soft"
              title={`${counts[3]} · ${labels[3]}`}
            />
            <Segment
              width={share(counts[4])}
              tone="strong"
              title={`${counts[4]} · ${labels[4]}`}
            />
          </div>
        </div>
      )}

      <p className="type-caption text-muted-foreground">
        {summary.splitBothWays && (
          // The finding a mean would have hidden. Said before the counts,
          // because it changes what the counts mean.
          <span className="font-medium text-foreground">Opinion is split. </span>
        )}
        {summary.sentence}
      </p>
    </div>
  );
}

/**
 * Zero-width segments render nothing rather than a hairline. A 1px sliver
 * where nobody chose that option reads as one person having chosen it, which
 * on a five-point scale is a meaningful lie.
 */
function Segment({
  width,
  tone,
  title,
  rounded = "auto",
}: {
  width: number;
  tone: "strong" | "soft" | "neutral";
  title: string;
  rounded?: "auto" | "none";
}) {
  if (width <= 0) return null;
  return (
    <div
      title={title}
      style={{ width: `${width}%` }}
      className={cn(
        "min-w-0",
        rounded === "auto" && "first:rounded-l-sm last:rounded-r-sm",
        tone === "strong" && "bg-loss",
        tone === "soft" && "bg-loss/45",
        // "Just right" is not a loss. It is the only part of this bar that is
        // good news, and it must not be coloured like a problem.
        tone === "neutral" && "bg-profit/50",
      )}
    />
  );
}
