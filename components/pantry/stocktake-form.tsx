"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toBaseMilli } from "@/convex/lib/drift";
import {
  PACK_UNITS_FOR,
  formatCountedAt,
  formatQty,
  formatVariance,
  naturalPackUnit,
  toTypedQty,
  type BaseUnit,
  type PackUnit,
} from "./format";

/**
 * The weekly count.
 *
 * The one decision this screen is built around: the expected amount sits
 * BESIDE an empty field, never inside it. A pre-filled input cannot tell "she
 * looked and it matched" from "she never walked over there" — and since the
 * count is the anchor every pantry number is measured from, a screen that
 * lets one tap of Save stamp forty unverified guesses as counted would hollow
 * out the very thing it exists to establish.
 *
 * She is still confirming rather than counting from zero, which is what the
 * scope asks for: each row carries a ✓ button that fills the field with what
 * Sous expects. One tap per shelf, and a row she skips stays skipped.
 *
 * Variance appears as she types, not on save. A slipped decimal is caught
 * while she is still holding the tub.
 */

export interface StocktakeRow {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  /** What the ledger says should be there. */
  expectedMilli: number;
  /** When this one was last counted. Null = never. */
  countedAt: number | null;
}

export interface CountedLine {
  ingredientId: string;
  countedQtyMilli: number;
}

interface Entry {
  value: string;
  unit: PackUnit;
}

function parse(entry: Entry): number | null {
  const trimmed = entry.value.trim();
  if (trimmed === "") return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return toBaseMilli(Math.round(n * 1000), entry.unit);
}

export function StocktakeForm({
  rows,
  onSave,
  saving = false,
}: {
  rows: StocktakeRow[];
  onSave: (lines: CountedLine[]) => Promise<void> | void;
  saving?: boolean;
}) {
  const [entries, setEntries] = React.useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.id,
        { value: "", unit: naturalPackUnit(r.expectedMilli, r.baseUnit) },
      ]),
    ),
  );

  const set = (id: string, patch: Partial<Entry>) =>
    setEntries((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const counted = rows
    .map((row) => ({ row, milli: parse(entries[row.id]) }))
    .filter((r): r is { row: StocktakeRow; milli: number } => r.milli !== null);

  const varied = counted.filter((c) => c.milli !== c.row.expectedMilli).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="type-display">Stocktake</h1>
        <p className="type-body text-pretty text-muted-foreground">
          Count what you can get to. Anything you leave blank keeps the amount
          it already had, and keeps showing its age.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <ul className="divide-y">
          {rows.map((row) => {
            const entry = entries[row.id];
            const milli = parse(entry);
            const other = PACK_UNITS_FOR[row.baseUnit].find(
              (u) => u !== entry.unit,
            );
            return (
              <li key={row.id} className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="type-body">{row.name}</span>
                  <span className="type-caption text-muted-foreground">
                    Sous thinks{" "}
                    <span className="numeric">
                      {formatQty(row.expectedMilli, row.baseUnit)}
                    </span>{" "}
                    · {formatCountedAt(row.countedAt)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    // 44px minimum, because this is the button she will hit
                    // most and she is holding a tub in the other hand.
                    className="h-11 gap-1.5 px-3"
                    aria-label={`${row.name} matches ${formatQty(row.expectedMilli, row.baseUnit)}`}
                    onClick={() =>
                      set(row.id, {
                        value: toTypedQty(row.expectedMilli, entry.unit),
                      })
                    }
                  >
                    <Check aria-hidden className="size-4" />
                    Matches
                  </Button>

                  <div className="relative w-32">
                    <Input
                      value={entry.value}
                      inputMode="decimal"
                      placeholder="or count it"
                      // The unit is in the accessible name, not only in the
                      // suffix glyph — a screen reader must not have to
                      // guess what "750" means.
                      aria-label={`Counted ${row.name}, in ${entry.unit}`}
                      className="numeric-body h-11 pr-12"
                      onChange={(e) => set(row.id, { value: e.target.value })}
                    />
                    <span className="type-caption pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground">
                      {entry.unit}
                    </span>
                  </div>

                  {/* ONE button offering the OTHER unit, not a two-state
                      toggle. A toggle beside a field that already shows its
                      unit reads "kg · g kg" — three units in a row, one of
                      them twice. The field states what she is typing in; this
                      changes it. */}
                  {other && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="type-caption h-11 px-2.5 text-muted-foreground"
                      aria-label={`Count ${row.name} in ${other} instead`}
                      onClick={() => set(row.id, { unit: other })}
                    >
                      use {other}
                    </Button>
                  )}

                  {/*
                    Reserved space, so typing a digit never reflows the row
                    under her thumb — but by LAYOUT, not by a transparent
                    placeholder character. `flex-1` holds the width and
                    `min-h-5` the height, so the content can be genuinely
                    empty: a colour-hidden "·" is invisible to the eye and
                    fully audible to a screen reader, which would announce
                    "dot" every time she cleared a field.

                    Colour only, and only a colour transition. She sees this
                    on every keystroke, so nothing here may move or resize —
                    at that frequency motion reads as lag.
                  */}
                  <span
                    aria-live="polite"
                    className={cn(
                      "type-caption min-h-5 flex-1 text-right transition-colors duration-[var(--duration-fast)] ease",
                      milli === null
                        ? "text-transparent"
                        : milli === row.expectedMilli
                          ? "text-muted-foreground"
                          : "text-warn-foreground",
                    )}
                  >
                    {milli === null
                      ? ""
                      : formatVariance(milli - row.expectedMilli, row.baseUnit)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-caption min-w-40 flex-1 text-muted-foreground">
          {counted.length === 0
            ? "Nothing counted yet."
            : `${counted.length} of ${rows.length} counted${varied > 0 ? `, ${varied} not matching` : ""}.`}
        </p>
        <Button
          // Disabled rather than saving nothing: a stocktake of no
          // ingredients would still re-anchor the org's freshness clock and
          // make a fortnight of arithmetic read as freshly confirmed.
          disabled={counted.length === 0 || saving}
          onClick={() =>
            onSave(
              counted.map((c) => ({
                ingredientId: c.row.id,
                countedQtyMilli: c.milli,
              })),
            )
          }
        >
          {saving ? "Saving…" : "Save the count"}
        </Button>
      </div>
    </div>
  );
}
