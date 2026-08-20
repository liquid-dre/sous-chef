"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/day";
import type { DueEntry, PromptEntry } from "./types";

/**
 * The three kinds of thing that land on a day.
 *
 * No motion anywhere in this file. DESIGN.md §6 names "calendar day taps" in
 * its list of interactions that must not animate at all — she taps through
 * days dozens of times a day, and an animation on something that frequent
 * reads as lag rather than polish.
 */

export function DueCard({
  entry,
  orgSlug,
}: {
  entry: DueEntry;
  orgSlug: string;
}) {
  return (
    <li>
      <Link
        href={`/${orgSlug}/orders/${entry.orderId}`}
        className={cn(
          "flex min-h-11 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2",
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          // Hover only, no transition: see the file header.
          "hover:bg-muted",
        )}
      >
        <span className="type-label">
          {/* The kind is a word, never only a colour — it survives a
              greyscale screenshot (DESIGN.md §4). */}
          Due · {entry.who}
        </span>
        <span className="type-caption text-muted-foreground">
          {entry.summary}
        </span>
      </Link>
    </li>
  );
}

/**
 * A batch to start — and the one place consolidation becomes visible.
 *
 * When a batch covers two orders the card says so by name. That sentence is
 * the entire reason consolidation exists: "one batch covers Tariro and Rudo"
 * is what stops her baking twice, and batch granularity is her main waste
 * source (the scope's own words).
 */
export function StartCard({
  prompt,
  orgSlug,
}: {
  prompt: PromptEntry;
  orgSlug: string;
}) {
  const covers = prompt.covers;
  const names = covers.map((c) => c.who);
  const units = Math.round(prompt.qtyMilli / 1000);

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2",
        prompt.overdue
          ? "border-warn bg-warn-soft text-warn-foreground"
          : "bg-card",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="type-label">
          {prompt.overdue ? "Start now · " : "Start · "}
          {prompt.itemName}
        </span>
        <span className="type-caption text-muted-foreground">
          <span className="numeric">{prompt.batchCount}</span>{" "}
          {prompt.batchCount === 1 ? "batch" : "batches"} ·{" "}
          {/* "36 needed by", never a bare "36 for" — a floating number with
              no noun beside it is the reader's problem to solve. */}
          <span className="numeric">{units}</span> needed by{" "}
          {formatDay(prompt.firstDeliveryDay)}
        </span>
        {covers.length > 1 && (
          <span className="type-caption text-muted-foreground">
            One batch covers {names.slice(0, -1).join(", ")} and{" "}
            {names[names.length - 1]}.
          </span>
        )}
        {prompt.overdue && (
          <span className="type-caption">
            This should have gone in already.
          </span>
        )}
      </div>
      <div>
        {/* Two taps from here: this one, then Save. `item` preselects and
            `from` sends her back to the calendar rather than to the
            owner-only production screen. */}
        <Button variant="outline" size="sm" className="min-h-11 md:min-h-9" asChild>
          <Link
            href={`/${orgSlug}/production/new?item=${prompt.menuItemId}&from=calendar`}
          >
            Log production
          </Link>
        </Button>
      </div>
    </li>
  );
}

/**
 * Stocktake day.
 *
 * Informational for staff and actionable for the owner, and the difference is
 * a button rather than a hidden row: `stock.recordStocktake` is an
 * `ownerMutation`, so staff genuinely cannot record one — but in a two-person
 * kitchen the counting itself may well be delegated, so hiding it would leave
 * them wondering why nobody mentioned it.
 */
export function StocktakeCard({
  orgSlug,
  canRecord,
}: {
  orgSlug: string;
  canRecord: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="type-label">Stocktake day</span>
        <span className="type-caption text-muted-foreground">
          {canRecord
            ? "Count what is on the shelves and Sous will trust the pantry again."
            : "Counting day. Recording it is the owner's."}
        </span>
      </div>
      {canRecord && (
        <div>
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-9" asChild>
            <Link href={`/${orgSlug}/pantry/stocktake`}>Take a stocktake</Link>
          </Button>
        </div>
      )}
    </li>
  );
}
