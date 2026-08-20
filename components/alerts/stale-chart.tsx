"use client";

import { cn } from "@/lib/utils";

/**
 * A chart drawn on a figure Sous cannot fully vouch for.
 *
 * Built here because nothing like it exists — `components/charts-sous/` has
 * no desaturation, no grayscale, no stale treatment of any kind. The nearest
 * thing is `SousChart`'s `awaitingInput` ghost, which is about missing input
 * rather than untrustworthy input.
 *
 * The scope's reason is the whole design: "a confident-looking chart built on
 * 11-day-old data is exactly the failure this slice's degradation rules exist
 * to prevent." A chart is persuasive in a way a sentence is not — bars have
 * the authority of measurement — so when the measurement is stale the chart
 * has to look like it.
 *
 * Three rules:
 *
 * 1. **The age is ON the chart, not beside it.** A caption under a confident
 *    plot is read after the plot has already been believed. DESIGN.md §4 bans
 *    a number whose staleness is UNKNOWN, not one whose staleness is stated —
 *    but stating it somewhere she will not look is the same thing.
 * 2. **Desaturate, never hide.** The bars still carry their comparison; they
 *    just stop asserting. Withholding the chart would leave her with no way
 *    to see which ingredient is worst, which is information she still has.
 * 3. **No motion.** `filter` is not a compositor-friendly property and this
 *    is not a state that should animate into view — it is a fact about the
 *    data, true from the first frame.
 */

/**
 * A semantic fill, muted when the figure behind it is.
 *
 * `color-mix` toward the muted foreground rather than a CSS `filter`:
 * filtering the whole plot would desaturate the axis labels and the grid too,
 * and those are not the untrustworthy part.
 */
export function staleFill(token: string, stale: boolean): string {
  return stale
    ? `color-mix(in oklch, ${token}, var(--chart-foreground-muted) 55%)`
    : token;
}

export function StaleChartFrame({
  stale,
  daysSinceCount,
  children,
  className,
}: {
  stale: boolean;
  /** Null when the pantry has never been counted at all — a different
   * sentence, because "never confirmed" is not "went out of date". */
  daysSinceCount: number | null;
  children: React.ReactNode;
  className?: string;
}) {
  if (!stale) return <>{children}</>;

  const age =
    daysSinceCount === null
      ? "never counted"
      : daysSinceCount === 0
        ? "counted today"
        : daysSinceCount === 1
          ? "1 day old"
          : `${daysSinceCount} days old`;

  return (
    <div className={cn("relative", className)}>
      {children}
      {/* Over the plot, top-left, where the eye lands before it reads a bar.
          pointer-events-none so it never swallows a tooltip hover. */}
      <span
        className={cn(
          "type-caption pointer-events-none absolute top-0 left-0 rounded-md px-1.5 py-0.5",
          "bg-warn-soft text-warn-foreground",
        )}
      >
        {age}
      </span>
    </div>
  );
}
