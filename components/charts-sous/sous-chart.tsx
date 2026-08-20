"use client";

import type { LucideIcon } from "lucide-react";
import { GRAIN_LABEL, formatCount, type Grain } from "./format";
import { cn } from "@/lib/utils";

/**
 * The frame every Sous chart lives in (DESIGN.md §5): title, period label,
 * honest sample size, and the three required states designed once —
 * empty (names what's missing), single (one data point is NOT drawn as a
 * trend — NEVER SHIP), dense (pre-aggregated upstream; the grain is stated).
 *
 * MOBILE RULES, decided here for every later slice (380px is the floor):
 * - Horizontal bars: category labels truncate; the tooltip carries the full
 *   label, so a tap reveals what the ellipsis hides.
 * - Scatter: thin to ≤200 points before rendering (sample, state the n).
 * - Heatmap: horizontal scroll via `scrollMinWidth` — cells never shrink
 *   below tap size; the container scrolls instead.
 * - Bklit Brush is desktop-only (`hidden md:block`); mobile uses the
 *   PeriodSwitcher.
 * - Interactive chart surfaces are the whole plot (crosshair tooltips), not
 *   4px points — ≥44px effective targets throughout.
 */

/**
 * `awaitingInput` keeps the axes and overlays the instruction. It exists for
 * charts whose axes are meaningful before any data arrives — a solution
 * surface has a yield axis and a margin axis whether or not the recipe has
 * been filled in, and replacing them with a card would hide the shape of the
 * question. `empty` remains right where the axes would be arbitrary.
 */
export type SousChartState = "ready" | "empty" | "single" | "awaitingInput";

export function SousChart({
  title,
  periodLabel,
  sampleSize,
  sampleNoun = "orders",
  grain,
  state = "ready",
  emptyIcon: EmptyIcon,
  emptyTitle = "Nothing to draw yet",
  emptyBody,
  singleValue,
  singleLabel,
  scrollMinWidth,
  caption,
  className,
  children,
}: {
  title: string;
  periodLabel?: string;
  /** Raw rows behind the chart — n = is stated wherever a claim depends on it. */
  sampleSize?: number;
  sampleNoun?: string;
  grain?: Grain;
  state?: SousChartState;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyBody?: string;
  /** The one value a single-point chart is about, pre-formatted. */
  singleValue?: string;
  singleLabel?: string;
  /** Mobile: scroll horizontally instead of shrinking below tap size. */
  scrollMinWidth?: number;
  /** Sits under the plot but OUTSIDE the horizontal scroller, so a legend or
   * a note explaining the marks cannot slide out of view with the bars. */
  caption?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn("flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5", className)}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="type-title min-w-0 truncate">{title}</h3>
        {periodLabel && (
          <span className="type-caption shrink-0 text-muted-foreground">
            {periodLabel}
          </span>
        )}
      </header>

      {state === "empty" ? (
        <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-6 text-center">
          {EmptyIcon && (
            <EmptyIcon aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.5} />
          )}
          <p className="type-body font-medium">{emptyTitle}</p>
          {emptyBody && (
            <p className="type-caption max-w-60 text-muted-foreground">{emptyBody}</p>
          )}
        </div>
      ) : state === "single" ? (
        /* A dot is not a line: one data point renders as the number itself,
           never as a trend (DESIGN.md NEVER SHIP: no trend through <8 points
           — and certainly not through 1). */
        <div className="flex min-h-44 flex-col items-center justify-center gap-1 text-center">
          <p className="numeric-xl">{singleValue}</p>
          {singleLabel && (
            <p className="type-caption text-muted-foreground">{singleLabel}</p>
          )}
          <p className="type-caption text-muted-foreground">
            One data point so far — a trend needs more days.
          </p>
        </div>
      ) : state === "awaitingInput" ? (
        /* Axes kept, instruction over them — never a flat line at zero, which
           would read as a costed answer of nothing. */
        <div className="relative">
          <div aria-hidden className="opacity-40">
            {children}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            {EmptyIcon && (
              <EmptyIcon aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.5} />
            )}
            <p className="type-body font-medium">{emptyTitle}</p>
            {emptyBody && (
              <p className="type-caption max-w-60 text-muted-foreground">{emptyBody}</p>
            )}
          </div>
        </div>
      ) : scrollMinWidth ? (
        <div className="overflow-x-auto">
          <div style={{ minWidth: scrollMinWidth }}>{children}</div>
        </div>
      ) : (
        children
      )}

      {caption && state !== "empty" && caption}

      {state === "ready" && sampleSize !== undefined && (
        <footer className="flex items-baseline justify-between gap-3">
          <span className="type-caption text-muted-foreground">
            {grain ? GRAIN_LABEL[grain] : null}
          </span>
          <span className="type-caption text-muted-foreground">
            n = <span className="numeric">{formatCount(sampleSize)}</span> {sampleNoun}
          </span>
        </footer>
      )}
    </section>
  );
}
