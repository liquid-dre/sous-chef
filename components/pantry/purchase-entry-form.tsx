"use client";

import * as React from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/components/numeric/money";
import { cn } from "@/lib/utils";
import {
  IngredientTypeahead,
  type IngredientOption,
  type TypeaheadValue,
} from "./ingredient-typeahead";
import {
  PACK_UNITS_FOR,
  formatUnitPrice,
  type BaseUnit,
  type PackUnit,
} from "./format";

/**
 * The load-bearing screen. She sits down with a receipt, so this is the one
 * place permitted to be desktop-dense: four fields per line, Enter moves
 * on, the derived unit price appears as she types.
 *
 * "Repeat last shop" turns a weekly grocery run into confirm-and-adjust
 * rather than fresh entry. If this is tedious the app dies quietly.
 */

export interface LastShop {
  purchasedAt: number;
  lineCount: number;
  totalCents: number;
  lines: {
    ingredientId: string;
    name: string;
    baseUnit: BaseUnit;
    packQtyMilli: number;
    packUnit: PackUnit;
    priceCents: number;
  }[];
}

interface Line {
  key: string;
  ingredient: TypeaheadValue;
  qty: string;
  packUnit: PackUnit | "";
  price: string;
}

let seq = 0;
const newLine = (): Line => ({
  key: `line-${seq++}`,
  ingredient: { label: "" },
  qty: "",
  packUnit: "",
  price: "",
});

function parseQty(raw: string): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
}
function parsePrice(raw: string): number {
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}
const PACK_BASE: Record<PackUnit, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  L: 1000,
  each: 1,
  dozen: 12,
};

/** Live derived unit price for one line, or null when it can't be known. */
function unitPriceFor(line: Line): { cents: number; baseUnit: BaseUnit } | null {
  const qtyMilli = parseQty(line.qty);
  const priceCents = parsePrice(line.price);
  const baseUnit = line.ingredient.baseUnit;
  if (!qtyMilli || !priceCents || !line.packUnit || !baseUnit) return null;
  const qtyBaseMilli = qtyMilli * PACK_BASE[line.packUnit];
  return {
    cents: Math.round((priceCents * 1_000_000) / qtyBaseMilli),
    baseUnit,
  };
}

export function PurchaseEntryForm({
  options,
  lastShop,
  onSave,
  disabled,
}: {
  options: IngredientOption[];
  lastShop: LastShop | null;
  onSave: (lines: {
    ingredientId?: string;
    newIngredient?: { name: string; baseUnit: BaseUnit };
    packQtyMilli: number;
    packUnit: PackUnit;
    priceCents: number;
  }[]) => Promise<void>;
  disabled?: boolean;
}) {
  const [lines, setLines] = React.useState<Line[]>(() => [newLine()]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<number | null>(null);
  /** The line whose ingredient field should take focus on mount. Without
   * this she has to reach for the mouse after every row — fatal on the one
   * screen she uses against a receipt, at speed. */
  const [focusKey, setFocusKey] = React.useState<string | null>(null);

  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Build the row OUTSIDE the updater: React runs updaters twice in dev
  // StrictMode, so creating the line inside would mint two keys and focus
  // the one that got thrown away.
  const addLine = () => {
    const line = newLine();
    setFocusKey(line.key);
    setLines((ls) => [...ls, line]);
  };
  const removeLine = (key: string) => {
    const replacement = newLine();
    setLines((ls) =>
      ls.length === 1 ? [replacement] : ls.filter((l) => l.key !== key),
    );
  };

  const repeatLastShop = () => {
    if (!lastShop) return;
    setSaved(null);
    setLines(
      lastShop.lines.map((l) => ({
        key: `line-${seq++}`,
        ingredient: {
          ingredientId: l.ingredientId,
          label: l.name,
          baseUnit: l.baseUnit,
        },
        qty: String(l.packQtyMilli / 1000),
        packUnit: l.packUnit,
        price: (l.priceCents / 100).toFixed(2),
      })),
    );
  };

  const ready = lines.filter(
    (l) =>
      (l.ingredient.ingredientId || l.ingredient.newIngredient) &&
      parseQty(l.qty) > 0 &&
      l.packUnit !== "" &&
      l.price.trim() !== "",
  );
  const totalCents = ready.reduce((n, l) => n + parsePrice(l.price), 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(
        ready.map((l) => ({
          ingredientId: l.ingredient.ingredientId,
          newIngredient: l.ingredient.newIngredient,
          packQtyMilli: parseQty(l.qty),
          packUnit: l.packUnit as PackUnit,
          priceCents: parsePrice(l.price),
        })),
      );
      setSaved(ready.length);
      setLines([newLine()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-display">Log a shop</h1>
          <p className="type-body text-muted-foreground">
            Straight off the receipt. Sous works out the unit price.
          </p>
        </div>
        {lastShop && (
          <Button variant="outline" onClick={repeatLastShop} disabled={disabled}>
            <RotateCcw aria-hidden data-icon="inline-start" />
            Repeat{" "}
            {new Date(lastShop.purchasedAt).toLocaleDateString("en-US", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}{" "}
            — {lastShop.lineCount} items
          </Button>
        )}
      </div>

      {saved !== null && (
        <p className="type-label animate-in fade-in-0 slide-in-from-top-1 rounded-md bg-profit-soft p-3 text-profit-foreground duration-[var(--duration-fast)] ease-out" role="status">
          {saved} {saved === 1 ? "line" : "lines"} recorded. Stock is up to date.
        </p>
      )}
      {error && (
        <p className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground" role="alert">
          {error}
        </p>
      )}

      {/* Dense on desktop, stacked on mobile — she may also be standing up. */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_9rem_2.5rem] gap-2 border-b px-3 py-2 md:grid">
          {["Ingredient", "Quantity", "Unit", "Price", "Works out at", ""].map(
            (h) => (
              <span key={h} className="type-caption text-muted-foreground">
                {h}
              </span>
            ),
          )}
        </div>

        <ul className="flex flex-col divide-y">
          {lines.map((line, i) => {
            const derived = unitPriceFor(line);
            const packUnits = line.ingredient.baseUnit
              ? PACK_UNITS_FOR[line.ingredient.baseUnit]
              : [];
            return (
              <li
                key={line.key}
                className="grid grid-cols-2 gap-2 p-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_9rem_2.5rem] md:items-center md:py-2"
              >
                <div className="col-span-2 md:col-span-1">
                  <IngredientTypeahead
                    value={line.ingredient}
                    options={options}
                    autoFocus={
                      line.key === focusKey || (i === 0 && lines.length === 1)
                    }
                    onChange={(ingredient) => {
                      // Switching family invalidates a chosen pack unit.
                      const keep =
                        ingredient.baseUnit &&
                        line.packUnit &&
                        PACK_UNITS_FOR[ingredient.baseUnit].includes(
                          line.packUnit as PackUnit,
                        );
                      update(line.key, {
                        ingredient,
                        packUnit: keep ? line.packUnit : "",
                      });
                    }}
                  />
                </div>

                <Input
                  value={line.qty}
                  inputMode="decimal"
                  placeholder="2"
                  aria-label="Pack quantity"
                  className="numeric-body"
                  onChange={(e) => update(line.key, { qty: e.target.value })}
                />

                <Select
                  value={line.packUnit}
                  disabled={packUnits.length === 0}
                  onValueChange={(v) =>
                    update(line.key, { packUnit: v as PackUnit })
                  }
                >
                  <SelectTrigger aria-label="Pack unit" className="w-full">
                    <SelectValue placeholder="unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {packUnits.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="relative">
                  <span className="numeric-sm pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    value={line.price}
                    inputMode="decimal"
                    placeholder="3.70"
                    aria-label="Price paid"
                    // md:pl-7 is required: the Input base sets md:px-2.5,
                    // and a media-query variant beats a bare utility, so
                    // without it the $ prefix sits on top of the number.
                    className="numeric-body pl-7 md:pl-7"
                    onChange={(e) => update(line.key, { price: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && i === lines.length - 1) addLine();
                    }}
                  />
                </div>

                <span
                  className={cn(
                    "numeric-sm",
                    derived ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {derived
                    ? formatUnitPrice(derived.cents, derived.baseUnit)
                    : "—"}
                </span>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove line"
                  onClick={() => removeLine(line.key)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t p-3">
          <Button variant="ghost" size="sm" onClick={addLine}>
            <Plus aria-hidden data-icon="inline-start" />
            Add a line
          </Button>
          <span className="type-caption text-muted-foreground">
            {ready.length} of {lines.length} ready ·{" "}
            <span className="numeric">{formatMoney(totalCents / 100)}</span>
          </span>
        </div>
      </div>

      <div>
        <Button
          size="lg"
          disabled={disabled || saving || ready.length === 0}
          onClick={save}
        >
          {saving
            ? "Recording…"
            : `Record ${ready.length || ""} ${ready.length === 1 ? "line" : "lines"}`.trim()}
        </Button>
      </div>
    </div>
  );
}
