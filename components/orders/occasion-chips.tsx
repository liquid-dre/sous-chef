"use client";

import { cn } from "@/lib/utils";

/**
 * One optional tap that makes every reorder reminder in Phase 8 possible.
 * Nothing else on the order captures why she was baking, and a year later
 * "the Moyo wedding" is the only handle anyone has on it.
 *
 * The pill is the one already used for the stocktake day in Settings, kept
 * identical rather than hand-rolled a fourth time. Tapping the selected chip
 * clears it — an occasion is optional, so it must be un-choosable.
 */

export type Occasion =
  | "birthday"
  | "anniversary"
  | "wedding"
  | "funeral"
  | "church"
  | "corporate"
  | "justBecause";

const OCCASIONS: { value: Occasion; label: string }[] = [
  { value: "birthday", label: "Birthday" },
  { value: "anniversary", label: "Anniversary" },
  { value: "wedding", label: "Wedding" },
  { value: "funeral", label: "Funeral" },
  { value: "church", label: "Church" },
  { value: "corporate", label: "Corporate" },
  { value: "justBecause", label: "Just because" },
];

export function OccasionChips({
  value,
  onChange,
  disabled,
}: {
  value: Occasion | null;
  onChange: (value: Occasion | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Occasion">
      {OCCASIONS.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : o.value)}
            className={cn(
              "min-h-11 rounded-full border px-4 type-label outline-none transition-transform duration-[var(--duration-fast)] ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-9",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
