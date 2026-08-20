"use client";

import { cn } from "@/lib/utils";
import { formatCountedAt, formatQty, type BaseUnit } from "./format";

/**
 * The arithmetic behind the amount on hand.
 *
 * DESIGN.md §4 makes a derived number with no breakdown affordance a defect,
 * and after this slice the pantry level is the largest derived number in
 * Sous — every other figure that mentions stock is downstream of it. She will
 * not trust a number she cannot take apart, and the first time it disagrees
 * with the shelf this list is the only way to find out where.
 *
 * Two things it refuses to do:
 *
 * - **Hide superseded rows.** A receipt entered after a count is real, and it
 *   is dated before the count, so it moves nothing. Dropping it would leave a
 *   ledger that cannot explain why entering a purchase changed no number.
 *   It renders struck through with the reason said in words.
 * - **Colour alone.** Every state is carried by a word or a mark as well as a
 *   tone, so the list survives a greyscale WhatsApp screenshot.
 */

const REASON_LABEL: Record<string, string> = {
  purchase: "Bought",
  production: "Used in a batch",
  stocktake: "Counted",
  waste: "Thrown away",
  adjustment: "Corrected",
};

export interface LedgerRow {
  id: string;
  deltaMilli: number;
  reason: string;
  note: string | null;
  occurredAt: number;
  runningMilli: number;
  superseded: boolean;
  isAnchor: boolean;
}

function when(at: number): string {
  return new Date(at).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

export function Ledger({
  rows,
  baseUnit,
  levelMilli,
  countedAt,
}: {
  rows: LedgerRow[];
  baseUnit: BaseUnit;
  /** The figure every row above the anchor adds up to. */
  levelMilli: number;
  /** When it was last physically counted. Null = never. */
  countedAt: number | null;
}) {
  return (
    <section
      aria-label="What moved"
      className="flex flex-col gap-3 rounded-lg border bg-card p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="type-title">What moved</h2>
        {/* The age travels WITH the figure, everywhere the figure goes.
            DESIGN.md's NEVER SHIP list: a number displayed without knowing
            whether it is stale. That the page header above also states it is
            not a defence — this number has to survive being read on its own,
            or screenshotted on its own. */}
        <span className="flex flex-col items-end">
          <span className="numeric-body">{formatQty(levelMilli, baseUnit)}</span>
          <span className="type-caption text-muted-foreground">
            {formatCountedAt(countedAt)}
          </span>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="type-body text-muted-foreground">
          Nothing has moved yet. Log a shop and it appears here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {rows.map((row) => (
            <li
              key={row.id}
              className={cn(
                "flex items-baseline justify-between gap-3 py-2",
                // −mt-px pulls the rule over the divide-y line rather than
                // stacking on top of it: without it the turning point reads
                // as a 3px double border, which looks like a rendering
                // accident instead of a deliberate mark.
                row.isAnchor && "-mt-px border-t-2 border-t-foreground/20",
              )}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "type-body",
                    row.superseded && "text-muted-foreground line-through",
                  )}
                >
                  {REASON_LABEL[row.reason] ?? row.reason}
                </span>
                <span className="type-caption block text-muted-foreground">
                  {when(row.occurredAt)}
                  {row.note ? ` · ${row.note}` : ""}
                  {/* Said in words, never left to the strikethrough alone.
                      "Why did entering that receipt change nothing?" is
                      answered here or nowhere. */}
                  {row.superseded && " · dated before the count, so it doesn't count"}
                  {row.isAnchor && " · the count starts the amount again here"}
                </span>
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <span
                  className={cn(
                    "numeric-sm",
                    row.superseded
                      ? "text-muted-foreground line-through"
                      : row.deltaMilli < 0
                        ? "text-loss"
                        : "text-muted-foreground",
                  )}
                >
                  {/* On the anchor row the delta is the VARIANCE, and it is
                      the number a stocktake exists to produce. Printing
                      "counted" here would hide the one fact she opened this
                      list to find. It is not added to the running total —
                      the count replaces the arithmetic rather than adjusting
                      it — so it is labelled as a discrepancy, not a move. */}
                  {row.isAnchor
                    ? row.deltaMilli === 0
                      ? "matched"
                      : `${formatQty(Math.abs(row.deltaMilli), baseUnit)} ${row.deltaMilli < 0 ? "short" : "over"}`
                    : `${row.deltaMilli > 0 ? "+" : "−"}${formatQty(Math.abs(row.deltaMilli), baseUnit)}`}
                </span>
                <span className="numeric-sm w-20 text-right">
                  {formatQty(row.runningMilli, baseUnit)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
