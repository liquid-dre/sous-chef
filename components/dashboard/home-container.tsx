"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChartNoAxesColumn, ReceiptText } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useClientToday } from "@/components/use-client-today";
import { boundsForDay } from "@/lib/period";
import {
  PeriodProvider,
  PeriodSwitcher,
  usePeriod,
} from "@/components/charts-sous/use-period";
import { Claim } from "./claim";
import { LeakList } from "./leak-list";
import { UncostedRing } from "./uncosted-ring";
import { ConfidenceNote } from "@/components/pantry/confidence-note";

/**
 * Home. One claim, and the evidence behind it.
 *
 * She opens Sous once a week for thirty seconds, on a mid-range Android over
 * 3G. So the CLAIM is plain text driven by a small query, and every chart
 * below it is dynamically imported — their JavaScript is off the critical
 * path entirely, and the sentence is readable before any of it arrives.
 *
 * The order on the screen is the argument: the answer, then what is hurting
 * the answer, then the picture of where it went. Nothing above the sentence.
 */

/** The Sankey pulls in visx and d3-sankey. It must not block the sentence. */
const MoneyFlow = dynamic(() => import("./money-flow").then((m) => m.MoneyFlow), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-lg border bg-card" />,
});

/** What the server already worked out, so the sentence is in the HTML. */
export interface ServerRendered {
  day: string;
  data: ClaimPayload;
}

type ClaimPayload = NonNullable<
  ReturnType<typeof useQuery<typeof api.dashboard.claim>>
>;

export function HomeContainer({
  orgSlug,
  initial,
}: {
  orgSlug: string;
  initial?: ServerRendered | null;
}) {
  return (
    // serverDay makes the hydrating client agree with the server about which
    // month it is, so the numbers in the HTML are not swapped for different
    // ones a moment later.
    <PeriodProvider defaultPeriod="month" serverDay={initial?.day}>
      <Inner orgSlug={orgSlug} initial={initial} />
    </PeriodProvider>
  );
}

function Inner({
  orgSlug,
  initial,
}: {
  orgSlug: string;
  initial?: ServerRendered | null;
}) {
  const today = useClientToday();
  const { bounds, label } = usePeriod();

  // The server only pre-rendered the DEFAULT window. Reuse it only while the
  // window still matches — otherwise switching to "this week" would flash the
  // month's numbers under a "This week" heading, which is worse than a
  // skeleton.
  const initialBounds = initial ? boundsForDay("month", initial.day) : null;
  const matchesInitial =
    initialBounds != null &&
    initialBounds.start === bounds.start &&
    initialBounds.end === bounds.end;

  const args =
    today || initial ? { orgSlug, start: bounds.start, end: bounds.end } : "skip";
  const live = useQuery(api.dashboard.claim, args);
  const claim = live ?? (matchesInitial ? initial!.data : undefined);
  // Deliberately a SECOND query, issued alongside: the sentence renders the
  // moment its own (much smaller) payload lands, rather than waiting for the
  // rankings and the flow tree.
  const breakdown = useQuery(api.dashboard.breakdown, args);
  // Two index reads, issued alongside; it renders nothing while fresh.
  const pantry = useQuery(
    api.stock.confidence,
    today ? { orgSlug, today } : "skip",
  );

  if (!claim) return <ClaimSkeleton />;

  if (!claim.hasAnyOrder) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="type-display-sm">Home</h1>
          <PeriodSwitcher />
        </div>
        <EmptyState
          icon={ReceiptText}
          title="Nothing delivered yet"
          body="Take an order and mark it delivered, and this becomes one sentence about whether you made money."
          actionLabel="Take an order"
          actionHref={`/${orgSlug}/orders/new`}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-display-sm">Home</h1>
        <PeriodSwitcher />
      </div>

      {/* 1. The answer. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Claim
            data={{
              periodLabel: label,
              ...claim.pnl,
              previousPeriodMarginPercent:
                claim.comparison.previousPeriodMarginPercent,
              rollingFourWeekMarginPercent:
                claim.comparison.rollingFourWeekMarginPercent,
            }}
          />
        </div>
        {claim.pnl.uncostedRevenueCents > 0 && (
          <UncostedRing sharePercent={claim.pnl.uncostedSharePercent} />
        )}
      </div>

      {/* 2. What is hurting it. */}
      <LeakList leaks={claim.leaks} allHref={`/${orgSlug}/insights/recommendations`} />

      {/* Only when Sous cannot fully vouch for the pantry, and never when it
          can — a reassurance banner on every load is chrome she learns to
          skip, and she would skip the day it turned amber too. Its own tiny
          query, so the claim above never waits on it (CONTEXT.md — two
          missed stocktakes puts alerts dormant and the dashboard says so). */}
      {pantry && <ConfidenceNote confidence={pantry} orgSlug={orgSlug} />}

      {/* 3. The picture of where it went. */}
      {breakdown && (
        <MoneyFlow
          data={breakdown.sankey}
          periodLabel={label}
          orderCount={claim.pnl.orderCount}
        />
      )}

      <nav aria-label="Look closer" className="flex flex-col gap-2 border-t pt-4">
        <h2 className="type-label text-muted-foreground">Look closer</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { href: `/${orgSlug}/insights/recommendations`, label: "What to fix" },
            { href: `/${orgSlug}/insights/items`, label: "Item ranking" },
            { href: `/${orgSlug}/insights/orders`, label: "Worst orders" },
            { href: `/${orgSlug}/insights/customers`, label: "Customers" },
            { href: `/${orgSlug}/insights/trend`, label: "Over time" },
          ].map((link) => (
            <Button key={link.href} variant="outline" size="sm" asChild>
              <Link href={link.href}>
                <ChartNoAxesColumn aria-hidden /> {link.label}
              </Link>
            </Button>
          ))}
        </div>
      </nav>
    </div>
  );
}

/**
 * The shape of the sentence, not a spinner. She is looking for one line of
 * text; a spinner tells her nothing about what is coming (DESIGN.md §7).
 */
function ClaimSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
      <div className="flex flex-col gap-3">
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
        <div className="h-9 w-full max-w-lg animate-pulse rounded bg-muted" />
        <div className="h-5 w-64 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
