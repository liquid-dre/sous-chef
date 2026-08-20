"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Confidence } from "@/convex/lib/stock";

/**
 * How much Sous is standing behind the pantry, said in one line.
 *
 * Written from CONTEXT.md's own sentence: "when purchase logging goes stale,
 * alerts soften to 'estimates are 11 days old, take a stocktake' rather than
 * firing confident wrong reds. Two missed stocktakes in a row puts alerts
 * dormant and the dashboard says so. A wrong red alert twice and she mutes
 * the system forever."
 *
 * Three rules the shape follows:
 *
 * 1. **Fresh renders nothing.** A green "everything is fine" banner on every
 *    load is chrome she learns to skip, and the day it changes to amber she
 *    will skip that too.
 * 2. **The numbers still show.** Dormant does not withhold the levels; it
 *    states what they are worth. DESIGN.md §4 bans a number whose staleness
 *    is UNKNOWN, not one whose staleness is stated.
 * 3. **Every state ends in the one action that fixes it.** A warning with no
 *    door out is just a complaint.
 */

export interface ConfidenceProps {
  state: Confidence;
  daysSinceCount: number | null;
  daysSincePurchase: number | null;
  missedCounts: number;
  purchaseLoggingStale: boolean;
  dueToday: boolean;
}

function days(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

function sentence(c: ConfidenceProps): string | null {
  switch (c.state) {
    case "fresh":
      // Due today is worth one quiet line — it is an appointment, not a
      // failure, and it is the one moment saying so costs her nothing.
      return c.dueToday ? "Stocktake day. Nothing counted yet." : null;
    case "neverCounted":
      return "These amounts are worked out from your receipts and recipes. Nothing has been counted yet, so nothing has confirmed them.";
    case "stale":
      if (c.purchaseLoggingStale && c.daysSincePurchase !== null) {
        return `No shop logged in ${days(c.daysSincePurchase)}, so these amounts don't know about anything that has arrived since.`;
      }
      return `A stocktake was missed. These amounts are ${days(c.daysSinceCount ?? 0)} of arithmetic since anything was counted.`;
    case "dormant":
      return `${c.missedCounts} stocktakes missed. These amounts are still here, but they are ${days(c.daysSinceCount ?? 0)} of arithmetic with nothing confirming them — Sous has stopped raising pantry alerts off them rather than raising wrong ones.`;
  }
}

export function ConfidenceNote({
  confidence,
  orgSlug,
  className,
}: {
  confidence: ConfidenceProps;
  orgSlug: string;
  className?: string;
}) {
  const body = sentence(confidence);
  if (body === null) return null;

  // The door out has to fix the cause that was just stated. Offering "take a
  // stocktake" against "no shop logged in 18 days" is a warning with no exit —
  // counting the pantry does not tell Sous about the deliveries it missed.
  const purchasesAreTheProblem =
    confidence.state === "stale" && confidence.purchaseLoggingStale;
  const action = purchasesAreTheProblem
    ? { href: `/${orgSlug}/pantry/purchases/new`, label: "Log a shop" }
    : { href: `/${orgSlug}/pantry/stocktake`, label: "Take a stocktake" };

  // Amber is the semantic warn token, never derived from her palette: a
  // pantry Sous cannot vouch for is a warning, not brand chrome (DESIGN.md
  // §5). Dormant gets the stronger tone; the other two sit quieter.
  const loud = confidence.state === "dormant";

  return (
    <section
      aria-label="How current these amounts are"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg p-3",
        loud
          ? "bg-warn-soft text-warn-foreground"
          : "border bg-card text-muted-foreground",
        className,
      )}
    >
      <p className="type-caption min-w-40 flex-1 text-pretty">{body}</p>
      <Link
        href={action.href}
        // 44px tall, because it is the only thing on this banner she can act
        // on and it sits on a phone.
        className="type-label flex min-h-11 shrink-0 items-center underline underline-offset-4"
      >
        {action.label}
      </Link>
    </section>
  );
}
