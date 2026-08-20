"use client";

import { RingChart } from "@/components/charts/ring-chart";
import { Ring } from "@/components/charts/ring";

/**
 * The share of the period Sous can actually analyse.
 *
 * Small, beside the claim, never hidden in a drill-down — because it is the
 * caveat ON the claim, and a caveat behind a tap is a caveat nobody reads.
 *
 * ONE ring, not two segments. There is no pie or donut anywhere in the
 * vendored charts (`pie-chart.tsx` does not exist and `PieData` is a dead
 * type); `RingChart` draws concentric `value / maxValue` gauges. That turns
 * out to be the right shape anyway: costed-vs-uncosted is a single proportion,
 * not two things being compared, and a gauge says "this much of it" more
 * directly than two arcs the eye has to measure against each other.
 */
export function UncostedRing({ sharePercent }: { sharePercent: number }) {
  const costed = 100 - sharePercent;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div className="relative" aria-hidden>
        <RingChart
          data={[{ label: "Costed", value: costed, maxValue: 100 }]}
          size={104}
          strokeWidth={10}
          baseInnerRadius={36}
          animationDuration={200}
        >
          <Ring index={0} color="var(--chart-1)" />
        </RingChart>
        {/* Our own centre: the vendored RingCenter runs raw values through
            NumberFlow, which is a money-format violation waiting to happen. */}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="numeric-lg">{costed}%</span>
        </span>
      </div>
      <p className="type-caption max-w-32 text-center text-muted-foreground">
        of what you took can be costed
      </p>
    </div>
  );
}
