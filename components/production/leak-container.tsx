"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RouteLoading } from "@/components/route-loading";
import { Money } from "@/components/numeric/money";
import { Button } from "@/components/ui/button";
import { useClientToday } from "@/components/use-client-today";
import { PeriodProvider, PeriodSwitcher, usePeriod } from "@/components/charts-sous/use-period";
import {
  MadeVersusSoldChart,
  WasteRateChart,
  YieldVarianceChart,
  type MadeVsSoldRow,
  type VariancePoint,
  type WastePoint,
} from "./leak-charts";
import { parseDay } from "@/lib/day";

/**
 * The leak, on one screen. Owner-only, and enforced on the server:
 * `madeVersusSold` is an `ownerQuery` and `stockOnHand` nulls its money for
 * staff, so this component could not leak a cost even if the route gate went
 * missing.
 */
export function LeakContainer({ orgSlug }: { orgSlug: string }) {
  return (
    <PeriodProvider defaultPeriod="month">
      <Inner orgSlug={orgSlug} />
    </PeriodProvider>
  );
}

function Inner({ orgSlug }: { orgSlug: string }) {
  const today = useClientToday();
  const { bounds, label } = usePeriod();

  const summary = useQuery(
    api.production.madeVersusSold,
    today ? { orgSlug, start: bounds.start, end: bounds.end } : "skip",
  );
  const stock = useQuery(api.production.stockOnHand, { orgSlug });

  if (!summary || !stock) return <RouteLoading />;

  const rows = summary.rows as MadeVsSoldRow[];

  // Waste rate per day with a batch on it. Aggregated here rather than on the
  // server because the period is the client's to choose — but from each
  // batch's OWN waste, never from its item's period-wide rate.
  const byDay = new Map<string, { made: number; wasted: number }>();
  for (const b of summary.batches) {
    const bucket = byDay.get(b.producedOn) ?? { made: 0, wasted: 0 };
    bucket.made += b.actualMilli;
    bucket.wasted += b.wastedMilli;
    byDay.set(b.producedOn, bucket);
  }
  const wastePoints: WastePoint[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      date: parseDay(day),
      wastePercent: v.made > 0 ? Math.round((v.wasted * 100) / v.made) : 0,
    }));

  const variancePoints: VariancePoint[] = summary.batches.map((b) => ({
    date: parseDay(b.producedOn),
    variancePercent: b.variancePercent,
    name: b.name,
    expectedUnits: b.expectedMilli / 1000,
    actualUnits: b.actualMilli / 1000,
  }));

  const wastedValue = rows.reduce((s, r) => s + r.wasteValueCents, 0);
  // Null for staff — the value of the shelf is hers, not theirs.
  const onHandValue = stock.live.reduce((s, r) => s + (r.valueCents ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="type-display-sm">What you made</h1>
          <p className="type-body text-muted-foreground">
            Against what somebody paid for.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSwitcher />
          <Button asChild size="sm">
            <Link href={`/${orgSlug}/production/new`}>Log a batch</Link>
          </Button>
        </div>
      </div>

      {/* The headline, before any chart: the one number this slice exists to
          surface. */}
      {(wastedValue > 0 || onHandValue > 0) && (
        <section
          aria-label="What it cost"
          className="rounded-lg border bg-card p-4 md:p-5"
        >
          {wastedValue > 0 ? (
            <p className="type-body">
              <span className="numeric-lg">
                <Money amount={wastedValue / 100} size="lg" />
              </span>{" "}
              of what you baked {label.toLowerCase()} was never paid for.
            </p>
          ) : (
            <p className="type-body">
              Nothing you baked {label.toLowerCase()} has gone to waste.
            </p>
          )}
          {onHandValue > 0 && (
            <p className="type-caption pt-1 text-muted-foreground">
              {wastedValue > 0 ? "Another " : ""}
              <Money amount={onHandValue / 100} size="sm" /> is still on the
              shelf and can still be sold.
            </p>
          )}
        </section>
      )}

      {stock.expired.length > 0 && (
        <section
          aria-label="Gone off"
          className="flex flex-col gap-2 rounded-lg border bg-card p-4 md:p-5"
        >
          <h2 className="type-title">Past its shelf life</h2>
          <ul className="flex flex-col divide-y">
            {stock.expired.map((r) => (
              <li
                key={r.productionLogId}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <span className="type-body min-w-0 flex-1 truncate">
                  {r.name}
                </span>
                <span className="numeric-sm text-muted-foreground">
                  {r.qtyMilli / 1000} from {r.producedOn}
                </span>
                {r.valueCents != null && (
                  <span className="numeric-sm w-20 text-right">
                    <Money amount={r.valueCents / 100} size="sm" />
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="type-caption text-muted-foreground">
            Costed at what it cost to make, not at today&rsquo;s prices.
          </p>
        </section>
      )}

      <MadeVersusSoldChart rows={rows} />
      <WasteRateChart points={wastePoints} />
      <YieldVarianceChart points={variancePoints} />
    </div>
  );
}

