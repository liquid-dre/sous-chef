"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/empty-state";
import { CookingPot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClientToday } from "@/components/use-client-today";
import { addDays, formatDay, parseDay } from "@/lib/day";
import { SubRecipePrompt, type SubShortfall } from "./sub-recipe-prompt";

/**
 * "Made it" plus the actual yield. Everything else is prefilled.
 *
 * The one field that matters is the one she corrects: the recipe says twelve,
 * she got ten. That gap is her real waste rate, and until this screen existed
 * nothing in Sous could see it — every cost figure quietly assumed the recipe
 * tells the truth.
 *
 * So the actual-yield field is the loudest thing here, the variance is stated
 * beside it in her words rather than as a percentage she has to interpret,
 * and the overhang and its expiry update as she types — because "four spare,
 * good until Thursday" is the sentence that decides whether she bakes again.
 */

export interface NeedsMakingRow {
  menuItemId: string;
  name: string;
  baseBatchYield: number;
  shelfLifeHours: number | null;
  neededMilli: number;
  suggestedBatchCount: number;
  orders: { id: string; who: string; deliveryDate: string; qtyMilli: number }[];
}

export interface ProductionDraft {
  menuItemId: string;
  batchCount: number;
  actualUnits: number;
  orderIds: string[];
  wasteUnits: number;
  wasteReason: string;
  /** Sub-recipes she agreed to log alongside this batch. Empty is the normal
   * case; when it is not, both logs land in one transaction so the sub's raw
   * ingredients come off through the sub's OWN record. */
  subs: { menuItemId: string; batchCount: number }[];
}

/**
 * The day the batch is good through, worked out from HER today rather than
 * the server's — a shelf life resolved in UTC tells a Harare kitchen at
 * 23:00 the wrong day (lib/day.ts).
 *
 * Deliberately built from the day string rather than `Date.now()`: the day
 * is stable within a render, and an unstable value here is not merely
 * imprecise — useSyncExternalStore throws on a snapshot that changes every
 * call, which takes the whole form down with it.
 */
function expiryLabel(hours: number | null, today: string): string | null {
  if (hours == null || !today) return null;
  return parseDay(addDays(today, Math.floor(hours / 24))).toLocaleDateString(
    "en-US",
    { weekday: "long", day: "numeric", month: "short" },
  );
}

export function ProductionForm({
  rows,
  saving,
  onLog,
  initialMenuItemId,
  subShortfalls = [],
  onSelectionChange,
}: {
  rows: NeedsMakingRow[];
  saving?: boolean;
  onLog: (draft: ProductionDraft) => Promise<void>;
  /** Which item to open on. The calendar sends her here from one start
   * prompt, and arriving on a different item would make her find it again —
   * which is the second of the two taps the scope allows. Falls back to the
   * first row when the item is not in today's list. */
  initialMenuItemId?: string;
  /** What the sub-recipe shelf cannot cover at the CURRENT item and batch
   * count. The container re-queries as either changes. */
  subShortfalls?: SubShortfall[];
  /** So the container can ask the server about this item at this batch count.
   * Lifting the pair out rather than querying in here keeps this component
   * free of Convex, which is what lets the specimen render it. */
  onSelectionChange?: (menuItemId: string | null, batchCount: number) => void;
}) {
  const [selected, setSelected] = React.useState<string | null>(
    (initialMenuItemId && rows.some((r) => r.menuItemId === initialMenuItemId)
      ? initialMenuItemId
      : rows[0]?.menuItemId) ?? null,
  );
  const row = rows.find((r) => r.menuItemId === selected) ?? null;

  const [batchCount, setBatchCount] = React.useState(1);
  const [actual, setActual] = React.useState("");
  const [linked, setLinked] = React.useState<string[]>([]);
  const [waste, setWaste] = React.useState("");
  const [wasteReason, setWasteReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Subs she has UNTICKED, not the ones she has ticked.
   *
   * Storing the refusals is what makes "ticked by default" a default rather
   * than an effect: a shortfall that appears when she raises the batch count
   * arrives already agreed to, and nothing has to notice it and write state
   * (which `react-hooks/set-state-in-effect` forbids anyway).
   *
   * Declared above the reset block below, which calls its setter — a `const`
   * used before its own declaration in the same render is a crash, not a
   * hoist.
   */
  const [declinedSubs, setDeclinedSubs] = React.useState<string[]>([]);

  // Picking a different item resets the numbers to that item's own prefill.
  // Adjusted during render rather than in an effect — the effect version
  // renders once with the previous item's figures still on screen.
  //
  // `undefined` rather than `selected` so the FIRST render prefills too:
  // seeded with `selected` this never fires on mount, and the field she is
  // here to correct arrives empty with nothing to correct.
  const [lastItem, setLastItem] = React.useState<string | null | undefined>(
    undefined,
  );
  if (lastItem !== selected) {
    setLastItem(selected);
    const next = rows.find((r) => r.menuItemId === selected);
    setBatchCount(next?.suggestedBatchCount ?? 1);
    setActual(String((next?.suggestedBatchCount ?? 1) * (next?.baseBatchYield ?? 0)));
    setLinked(next?.orders.map((o) => o.id) ?? []);
    setWaste("");
    setWasteReason("");
    // A different item has different sub-recipes, so agreements made about
    // the last one must not carry over.
    setDeclinedSubs([]);
  }

  const chosenSubs = subShortfalls
    .filter((s) => !declinedSubs.includes(s.subMenuItemId))
    .map((s) => s.subMenuItemId);

  // Told to the container during render rather than in an effect, and only
  // when the pair actually moves — so the query key changes exactly once per
  // real change.
  const [lastAsked, setLastAsked] = React.useState<string>("");
  const askKey = `${selected ?? ""}:${batchCount}`;
  if (askKey !== lastAsked) {
    setLastAsked(askKey);
    onSelectionChange?.(selected, batchCount);
  }

  const expectedUnits = (row?.baseBatchYield ?? 0) * batchCount;
  const actualUnits = Number.parseFloat(actual);
  const hasActual = Number.isFinite(actualUnits) && actualUnits >= 0;
  const wasteUnits = Number.parseFloat(waste);
  const wasted = Number.isFinite(wasteUnits) && wasteUnits > 0 ? wasteUnits : 0;

  // What the linked orders asked for, in units — summed over the ones she
  // actually ticked, not over every order the item has. Untick one and the
  // spare figure has to go up, because the server counts only the ticked
  // orders when it works out the overhang; anything else shows her a number
  // the save then contradicts. Nothing linked means the whole batch is spare,
  // which is exactly what a bake-ahead is.
  const neededUnits = row
    ? row.orders
        .filter((o) => linked.includes(o.id))
        .reduce((sum, o) => sum + o.qtyMilli, 0) / 1000
    : 0;

  const sellable = hasActual ? Math.max(0, actualUnits - wasted) : 0;
  const overhang = Math.max(0, sellable - neededUnits);
  const shortfall = Math.max(0, neededUnits - sellable);
  const variance = expectedUnits > 0 && hasActual ? actualUnits - expectedUnits : 0;
  // The server refuses this outright. Catching it here means she is told
  // before she taps, rather than by a thrown mutation after.
  const wasteTooHigh = hasActual && wasted > actualUnits;
  const expiry = expiryLabel(row?.shelfLifeHours ?? null, useClientToday());

  const setBatches = (next: number | ((current: number) => number)) =>
    setBatchCount((current) => {
      const value = typeof next === "function" ? next(current) : next;
      const clamped = Math.max(1, value);
      // The expected figure follows the batch count, and so does the
      // prefilled actual — until she has corrected it, at which point her
      // number is hers and must not be overwritten under her.
      if (row && actual === String(current * row.baseBatchYield)) {
        setActual(String(clamped * row.baseBatchYield));
      }
      return clamped;
    });

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CookingPot}
        title="Nothing booked in"
        body="Log a batch here once there are orders to bake for — or after the fact, for anything you made to have on hand."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-32">
      <section
        aria-label="What you made"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5"
      >
        <h2 className="type-title">What did you make?</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Item">
          {rows.map((r) => (
            <button
              key={r.menuItemId}
              type="button"
              aria-pressed={r.menuItemId === selected}
              onClick={() => setSelected(r.menuItemId)}
              className={cn(
                "min-h-11 rounded-full border px-4 type-label outline-none transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-9",
                r.menuItemId === selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {r.name}
            </button>
          ))}
        </div>
      </section>

      {row && (
        <>
          <section
            aria-label="Yield"
            className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:p-5"
          >
            <div className="flex flex-col gap-1.5">
              <Label className="type-label">How many batches</Label>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="One fewer batch"
                  onClick={() => setBatches((b) => b - 1)}
                >
                  <Minus aria-hidden />
                </Button>
                <Input
                  value={String(batchCount)}
                  inputMode="numeric"
                  aria-label="Batches"
                  className="numeric-body w-16 text-center"
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) setBatches(n);
                  }}
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="One more batch"
                  onClick={() => setBatches((b) => b + 1)}
                >
                  <Plus aria-hidden />
                </Button>
                <span className="type-caption pl-2 text-muted-foreground">
                  the recipe says{" "}
                  <span className="numeric">{expectedUnits}</span>
                </span>
              </div>
            </div>

            {/* The one field she is actually here to correct. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="actual-yield" className="type-label">
                How many did you actually get?
              </Label>
              <Input
                id="actual-yield"
                value={actual}
                inputMode="decimal"
                aria-label="Actual yield"
                className="numeric-lg h-14 md:h-12"
                onChange={(e) => setActual(e.target.value)}
              />
              {hasActual && variance !== 0 && (
                <p
                  className={cn(
                    "type-caption",
                    variance < 0 ? "text-warn-foreground" : "text-muted-foreground",
                  )}
                >
                  {variance < 0
                    ? `${Math.abs(variance)} short of what the recipe says.`
                    : `${variance} more than the recipe says.`}
                </p>
              )}
            </div>
          </section>

          {row.orders.length > 0 && (
            <section
              aria-label="Orders"
              className="flex flex-col gap-2 rounded-lg border bg-card p-4 md:p-5"
            >
              <h2 className="type-title">Who it&rsquo;s for</h2>
              <p className="type-caption text-muted-foreground">
                One batch can cover several orders.
              </p>
              <ul className="flex flex-col divide-y">
                {row.orders.map((o) => (
                  <li key={o.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
                      {/* The design system's control, not a raw input: it
                          carries the focus ring, the checked treatment and
                          the ::after hit-area expansion that a bare
                          accent-primary checkbox has none of. */}
                      <Checkbox
                        checked={linked.includes(o.id)}
                        onCheckedChange={(checked) =>
                          setLinked((ids) =>
                            checked
                              ? [...ids, o.id]
                              : ids.filter((id) => id !== o.id),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="type-body block truncate">{o.who}</span>
                        <span className="type-caption block text-muted-foreground">
                          {formatDay(o.deliveryDate)}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            aria-label="Waste"
            className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="waste-units" className="type-body">
                Any dropped or burnt
              </Label>
              <Input
                id="waste-units"
                value={waste}
                inputMode="decimal"
                placeholder="0"
                aria-label="Wasted units"
                className="numeric-body w-20 text-center"
                onChange={(e) => setWaste(e.target.value)}
              />
            </div>
            {wasteTooHigh && (
              <p className="type-caption text-loss-foreground" role="alert">
                You can&rsquo;t have wasted more than the{" "}
                <span className="numeric">{actualUnits}</span> you made.
              </p>
            )}
            {wasted > 0 && !wasteTooHigh && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="waste-reason" className="type-label">
                  What happened
                </Label>
                <Textarea
                  id="waste-reason"
                  rows={2}
                  value={wasteReason}
                  placeholder="Dropped the tray."
                  onChange={(e) => setWasteReason(e.target.value)}
                />
              </div>
            )}
          </section>

          {/* The sentence that decides whether she bakes again today. */}
          {hasActual && !wasteTooHigh && (
            <section
              aria-label="What's left"
              className="flex flex-col gap-2 rounded-lg border bg-card p-4 md:p-5"
            >
              {shortfall > 0 ? (
                <p className="type-body text-warn-foreground">
                  That leaves you <span className="numeric">{shortfall}</span>{" "}
                  short of what these orders need.
                </p>
              ) : overhang > 0 ? (
                <p className="type-body">
                  <span className="numeric">{overhang}</span> spare
                  {expiry ? (
                    <>
                      , good until <span className="whitespace-nowrap">{expiry}</span>
                    </>
                  ) : null}
                  .
                </p>
              ) : (
                <p className="type-body text-muted-foreground">
                  Exactly enough — nothing spare.
                </p>
              )}
              {overhang > 0 && (
                <p className="type-caption text-muted-foreground">
                  It goes on the shelf. Sell it and it costs what it cost to
                  make today; let it go off and that is what the waste is
                  worth.
                </p>
              )}
            </section>
          )}
        </>
      )}

      {error && (
        <p
          className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground"
          role="alert"
        >
          {error}
        </p>
      )}

      <SubRecipePrompt
        shortfalls={subShortfalls}
        chosen={chosenSubs}
        onToggle={(id, next) =>
          setDeclinedSubs((prev) =>
            next ? prev.filter((d) => d !== id) : [...prev, id],
          )
        }
      />

      <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-card/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:bottom-0">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <span className="type-caption text-muted-foreground">
            {hasActual && row ? (
              <>
                <span className="numeric">{actualUnits}</span> {row.name}
              </>
            ) : (
              "Tell it what you got"
            )}
          </span>
          <Button
            size="lg"
            disabled={!row || !hasActual || wasteTooHigh || saving}
            onClick={async () => {
              if (!row) return;
              setError(null);
              try {
                await onLog({
                  menuItemId: row.menuItemId,
                  batchCount,
                  actualUnits,
                  orderIds: linked,
                  wasteUnits: wasted,
                  wasteReason,
                  subs: subShortfalls
                    .filter((s) => chosenSubs.includes(s.subMenuItemId))
                    .map((s) => ({
                      menuItemId: s.subMenuItemId,
                      batchCount: s.batchesToCover,
                    })),
                });
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't log it.");
              }
            }}
          >
            {saving ? "Logging…" : "Made it"}
          </Button>
        </div>
      </div>
    </div>
  );
}
