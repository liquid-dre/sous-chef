"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatQty, type BaseUnit } from "@/components/pantry/format";
import { RunwayGauge } from "./runway-gauge";
import type { PantryTrust } from "@/convex/lib/alerts";

/**
 * One alert, and the sentence that makes it worth reading.
 *
 * CONTEXT.md draws the line exactly: "3 orders this week need 4 batches; you
 * have milk for 1" names the failure AND its date. "Milk is low" names a
 * shelf and leaves her to work out whether it matters. This card is built to
 * make the first sentence, never the second.
 *
 * The two halves have DIFFERENT confidence, and the copy has to show that.
 * What her orders need is arithmetic on food she has already promised — true
 * whatever the pantry says. What is on the shelf is the part that goes stale.
 * So the demand clause is stated flat, and only the supply clause ever
 * carries "but that figure is 11 days old".
 *
 * One resolve button, never a bulk close: the scope requires her to clear one
 * in the middle without touching the ones around it, because the whole point
 * of resolving is that she has dealt with THAT thing.
 */

export interface AlertRow {
  subjectKey: string;
  subjectId: string;
  type: string;
  severity: "red" | "amber";
  name: string;
  baseUnit: BaseUnit;
  shortfallMilli: number;
  staleDays: number | null;
  runway: {
    onHandMilli: number;
    bookedMilli: number;
    daysOfCover: number | null;
  };
}

/** The demand half. Always a plain statement of fact. */
function demandSentence(orderCount: number, demandBatches: number, horizonEnd: string): string {
  const orders = `${orderCount} ${orderCount === 1 ? "order" : "orders"}`;
  const batches = `${demandBatches} ${demandBatches === 1 ? "batch" : "batches"}`;
  return `${orders} before ${horizonEnd} need ${batches}.`;
}

/** The supply half. The ONLY clause that hedges. */
function supplySentence(row: AlertRow): string {
  const have = formatQty(row.runway.onHandMilli, row.baseUnit);
  const need = formatQty(row.runway.bookedMilli, row.baseUnit);
  const base =
    row.runway.bookedMilli > 0
      ? `That wants ${need} of ${row.name.toLowerCase()} and you have ${have}`
      : `You have ${have} of ${row.name.toLowerCase()}`;
  if (row.staleDays === null) return `${base}.`;
  // Stated inline rather than as a footnote, because a caveat below a
  // confident sentence is read after the sentence has been believed.
  return row.staleDays === 0
    ? `${base}, counted today.`
    : `${base} — but that figure is ${row.staleDays} ${row.staleDays === 1 ? "day" : "days"} old.`;
}

export function AlertCard({
  row,
  orderCount,
  demandBatches,
  horizonEnd,
  trust,
  onResolve,
  onMute,
  busy,
}: {
  row: AlertRow;
  orderCount: number;
  demandBatches: number;
  horizonEnd: string;
  trust: PantryTrust;
  onResolve: (message: string) => void;
  onMute: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const demand = demandSentence(orderCount, demandBatches, horizonEnd);
  const supply = supplySentence(row);
  const red = row.severity === "red";

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg p-4",
        // Semantic tokens only. A kitchen whose brand colour is red must not
        // have "you run out on Thursday" render as brand chrome (DESIGN.md §5).
        red ? "bg-loss-soft text-loss-foreground" : "bg-warn-soft text-warn-foreground",
      )}
    >
      <div className="flex flex-col gap-1">
        {/* Severity is in the word, not only the tone — it survives a
            greyscale screenshot and colourblind vision. */}
        <p className="type-label">
          {red ? "Short" : "Getting low"} · {row.name}
        </p>
        <p className="type-body text-pretty">{demand}</p>
        <p className="type-body text-pretty">{supply}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-9"
          disabled={busy}
          onClick={() => onResolve(`${demand} ${supply}`)}
        >
          {/* The card vanishing is the confirmation, but there is a round
              trip in between. A disabled button still reading "I've dealt
              with it" is indistinguishable from a dead control. */}
          {busy ? "Saving…" : "I’ve dealt with it"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-9"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide the working" : "Show the working"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-9"
          disabled={busy}
          onClick={onMute}
        >
          Stop telling me
        </Button>
      </div>

      {/* A derived number with no breakdown affordance is a defect
          (DESIGN.md §4), and every figure above is derived. */}
      {open && (
        // Opacity only, and only on the way in. Height is a layout property
        // and animating it would jank on the phone this is built for; a
        // panel that simply appears reads as a glitch rather than a reveal.
        <div className="animate-in fade-in-0 duration-[var(--duration-fast)] ease-out rounded-md bg-card/60 p-3">
          <RunwayGauge
            name={row.name}
            baseUnit={row.baseUnit}
            daysOfCover={row.runway.daysOfCover}
            onHandMilli={row.runway.onHandMilli}
            bookedMilli={row.runway.bookedMilli}
            severity={row.severity}
            trust={trust}
            daysSinceCount={row.staleDays}
          />
          <dl className="mt-2 flex flex-col gap-1">
            {[
              ["On hand", formatQty(row.runway.onHandMilli, row.baseUnit)],
              ["Your orders need", formatQty(row.runway.bookedMilli, row.baseUnit)],
              ["Short by", formatQty(row.shortfallMilli, row.baseUnit)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="type-caption">{label}</dt>
                <dd className="numeric-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  );
}
