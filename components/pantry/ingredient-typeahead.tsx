"use client";

import * as React from "react";
import { Check, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FAMILY_LABEL, formatUnitPrice, type BaseUnit } from "./format";

export interface IngredientOption {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  standardCostCentsPerThousand: number;
}

export interface TypeaheadValue {
  ingredientId?: string;
  newIngredient?: { name: string; baseUnit: BaseUnit };
  /** What's in the box, for display. */
  label: string;
  baseUnit?: BaseUnit;
}

/**
 * Opens on the FIRST keystroke with no debounce — she is typing off a
 * receipt and any delay reads as the app being slow. No match creates the
 * ingredient inline; she must never leave this screen to add one.
 */
export function IngredientTypeahead({
  value,
  options,
  onChange,
  autoFocus,
  onCommit,
}: {
  value: TypeaheadValue;
  options: IngredientOption[];
  onChange: (value: TypeaheadValue) => void;
  autoFocus?: boolean;
  /** Enter on a resolved row moves to the next field. */
  onCommit?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const term = value.label;

  const matches = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    return options
      .filter((o) => o.name.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [options, term]);

  const exact = matches.find(
    (m) => m.name.toLowerCase() === term.trim().toLowerCase(),
  );
  const canCreate = term.trim().length > 0 && !exact;
  const rows = canCreate ? matches.length + 1 : matches.length;

  const pick = (option: IngredientOption) => {
    onChange({
      ingredientId: option.id,
      label: option.name,
      baseUnit: option.baseUnit,
    });
    setOpen(false);
    onCommit?.();
  };

  const create = (baseUnit: BaseUnit) => {
    onChange({
      newIngredient: { name: term.trim(), baseUnit },
      label: term.trim(),
      baseUnit,
    });
    setOpen(false);
    onCommit?.();
  };

  return (
    <div className="relative">
      <Input
        value={term}
        autoFocus={autoFocus}
        placeholder="Ingredient"
        aria-label="Ingredient"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && rows > 0}
        onChange={(e) => {
          // No debounce: results appear as she types, from the first letter.
          onChange({ label: e.target.value });
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => term && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || rows === 0) {
            if (e.key === "Enter") onCommit?.();
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % rows);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + rows) % rows);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (highlight < matches.length) pick(matches[highlight]);
            else create("g");
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {open && rows > 0 && (
        <ul
          role="listbox"
          // Mount-only entrance from the field it belongs to. The list
          // re-renders on every keystroke without remounting, so results
          // never re-animate as she types.
          className="animate-in fade-in-0 zoom-in-95 absolute top-full left-0 z-50 mt-1 w-full min-w-56 origin-top overflow-hidden rounded-md border bg-popover shadow-float duration-[var(--duration-fast)] ease-out"
        >
          {matches.map((option, i) => (
            <li key={option.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left md:min-h-9",
                  i === highlight && "bg-muted",
                )}
              >
                <span className="type-body">{option.name}</span>
                <span className="numeric-sm text-muted-foreground">
                  {formatUnitPrice(
                    option.standardCostCentsPerThousand,
                    option.baseUnit,
                  )}
                </span>
                {value.ingredientId === option.id && (
                  <Check aria-hidden className="size-4 text-primary" />
                )}
              </button>
            </li>
          ))}

          {canCreate && (
            <li
              className={cn(
                "border-t p-2",
                highlight === matches.length && "bg-muted",
              )}
            >
              <p className="type-caption mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                <Plus aria-hidden className="size-3.5" />
                Add &ldquo;{term.trim()}&rdquo; — measured by
              </p>
              <div className="flex gap-1.5">
                {(["g", "ml", "unit"] as BaseUnit[]).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => create(unit)}
                    className="min-h-11 flex-1 rounded-md border bg-card px-2 type-label transition-transform duration-[var(--duration-fast)] ease-out hover:bg-muted active:scale-[0.97] md:min-h-9"
                  >
                    {FAMILY_LABEL[unit]}
                  </button>
                ))}
              </div>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
