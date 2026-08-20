"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RankedBars, splitSigned } from "@/components/dashboard/ranked-bars";
import { formatMoneyExact } from "@/components/charts-sous/format";
import { OCCASION_LABEL } from "@/convex/lib/contacts";
import { RepeatRing } from "./repeat-ring";

/**
 * The three charts, in the order they answer questions.
 *
 * WHO is worth most, whether the reminders are working, and WHAT to build a
 * campaign around. All period-bounded — a contact card is cumulative because
 * a person is, but the business is not, and "are the reminders working" is
 * only answerable across a window she can move.
 *
 * Loaded dynamically by the container, so this file may import the chart
 * bundle freely.
 */
export function CustomerCharts({
  orgSlug,
  start,
  end,
  periodLabel,
}: {
  orgSlug: string;
  start?: string;
  end: string;
  periodLabel: string;
}) {
  const data = useQuery(api.customers.insights, { orgSlug, start, end });
  if (data === undefined) {
    return <div className="h-64 animate-pulse rounded-lg border bg-card" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* BY PROFIT, not revenue. The customer who orders most is not
          necessarily the customer worth most — the same reframe 4.1 makes
          about menu items, and the reason the caption says so out loud. */}
      <RankedBars
        title="Worth most to you"
        periodLabel={periodLabel}
        sampleSize={data.topCustomers.length}
        sampleNoun="customers"
        emptyBody="Deliver an order and the customer appears here."
        caption="Ranked by what you keep, not by what they spend."
        formatValue={formatMoneyExact}
        rows={data.topCustomers.map((c) => splitSigned(c.name, c.profitCents))}
      />

      <RepeatRing split={data.repeat} periodLabel={periodLabel} />

      {/* A BAR, never a pie: seven occasion types is well past DESIGN.md's
          four-slice limit, and this chart's job is comparison anyway. The
          neutral fill is deliberate — an order COUNT has no good or bad
          direction, so the profit/loss tones would be a claim the data does
          not make. */}
      <RankedBars
        title="What they order for"
        periodLabel={periodLabel}
        sampleSize={data.occasions.reduce((n, o) => n + o.orders, 0)}
        sampleNoun="chipped orders"
        emptyBody="Tap an occasion on an order and the mix appears here."
        caption="Only orders you tagged with an occasion. Untagged ones are left out rather than lumped together."
        valueLabel="Orders"
        positiveFill="var(--chart-1)"
        negativeFill="var(--chart-1)"
        formatValue={(n) => `${n}`}
        rows={data.occasions.map((o) =>
          splitSigned(OCCASION_LABEL[o.occasion], o.orders),
        )}
      />
    </div>
  );
}
