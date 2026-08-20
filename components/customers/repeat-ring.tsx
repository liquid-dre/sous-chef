"use client";

import { RingChart } from "@/components/charts/ring-chart";
import { Ring } from "@/components/charts/ring";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { formatMoneyExact } from "@/components/charts-sous/format";
import type { RepeatSplit } from "@/convex/lib/contacts";

/**
 * How much of the money came from people coming back.
 *
 * ONE RING, not two segments — the idiom
 * `components/dashboard/uncosted-ring.tsx:12-17` already settled: there is no
 * pie or donut anywhere in the vendored charts, and `RingChart` draws
 * concentric `value / maxValue` gauges rather than proportions of a whole.
 * That turns out to be the right shape anyway, and the scope agrees: "a
 * genuine binary split, one number to read".
 *
 * Two vendored constraints, both worked around rather than fought:
 *
 * - **`RingCenter` is avoided.** It runs raw values through NumberFlow, which
 *   is a money-format violation waiting to happen (DESIGN.md §4). Both
 *   existing usages overlay their own centre and so does this.
 * - **`animationDuration` is a no-op.** It is declared on `RingChartProps`
 *   but never destructured in `ring-chart.tsx`, so passing it does nothing.
 *   Not passed, rather than passed and silently ignored.
 *
 * Null repeat share renders the empty state rather than a confident 0%: a
 * kitchen that has not traded in the window has no split, and "0% repeat" is
 * a claim about a business rather than an absence of data (DESIGN.md §7).
 */
export function RepeatRing({
  split,
  periodLabel,
}: {
  split: RepeatSplit;
  periodLabel: string;
}) {
  const percent = split.repeatPercent;
  const orders = split.repeatOrders + split.firstTimeOrders;

  return (
    <SousChart
      title="Repeat versus first-time"
      periodLabel={periodLabel}
      sampleSize={orders}
      sampleNoun="orders"
      state={percent === null ? "empty" : "ready"}
      emptyTitle="Nothing delivered yet"
      emptyBody="Once orders land, this shows how much of your money comes from people coming back."
      caption={
        percent !== null ? (
          <p className="type-caption text-center text-pretty text-muted-foreground">
            <span className="numeric">{formatMoneyExact(split.repeatCents)}</span>{" "}
            from{" "}
            <span className="numeric">{split.repeatOrders}</span>{" "}
            {split.repeatOrders === 1 ? "return order" : "return orders"}, and{" "}
            <span className="numeric">{formatMoneyExact(split.firstTimeCents)}</span>{" "}
            from{" "}
            <span className="numeric">{split.firstTimeOrders}</span> first{" "}
            {split.firstTimeOrders === 1 ? "order" : "orders"}. An order counts
            as a return whenever that customer has ordered before, however long
            ago.
          </p>
        ) : undefined
      }
    >
      <div className="flex flex-col items-center gap-1">
        <div className="relative" aria-hidden>
          <RingChart
            data={[{ label: "Repeat", value: percent ?? 0, maxValue: 100 }]}
            size={168}
            strokeWidth={12}
            baseInnerRadius={58}
          >
            <Ring index={0} color="var(--chart-1)" />
          </RingChart>
          {/* Our own centre — see the file header. */}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="numeric-xl">{percent ?? 0}%</span>
          </span>
        </div>
        <p className="type-caption max-w-40 text-center text-muted-foreground">
          of your money came from people coming back
        </p>
      </div>
    </SousChart>
  );
}
