"use client";

import { AXIS_LABEL, SENSORY_AXES, type SensoryAxis } from "@/convex/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * Which dimensions this item gets asked about.
 *
 * The library is FIXED (CONTEXT.md — Feedback), and that is the whole reason
 * the feature works: free text cannot aggregate, so "a bit sickly" and "too
 * sugary" would be two data points that never meet. Seven words that always
 * mean the same thing are worth more than infinite words that mean nothing
 * twice.
 *
 * Picking an axis is the entire target statement. There is no per-axis target
 * value and there must not be one — "just right" has to mean the same thing on
 * every scale, or a customer's midpoint and her intended midpoint would be two
 * different places on one line.
 */

/** CONTEXT.md's bound, and it is about the form: seven sliders on a phone is a
 * survey, and a survey does not get answered. */
const MAX_AXES = 4;
const MIN_AXES = 2;

export function AxisPicker({
  value,
  onChange,
  itemName,
}: {
  value: SensoryAxis[];
  onChange: (next: SensoryAxis[]) => void;
  itemName: string;
}) {
  const atMax = value.length >= MAX_AXES;
  // One is not a profile — a radar with one axis is a spoke, and one dimension
  // tells her nothing she could not have asked directly.
  const invalid = value.length === 1;

  const toggle = (axis: SensoryAxis) => {
    if (value.includes(axis)) {
      onChange(value.filter((a) => a !== axis));
    } else if (!atMax) {
      onChange([...value, axis]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="type-body text-muted-foreground">
          What is worth asking a customer about {itemName || "this"}? Two to
          four, from a fixed list — the same words every time is what lets Sous
          count them.
        </p>
      </div>

      <ul className="flex flex-wrap gap-2">
        {SENSORY_AXES.map((axis) => {
          const selected = value.includes(axis);
          const disabled = !selected && atMax;
          return (
            <li key={axis}>
              <button
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => toggle(axis)}
                className={cn(
                  "min-h-11 rounded-full border px-4 type-label outline-none",
                  "transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] ease-out",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
                  selected
                    ? "border-primary bg-primary-soft text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
                )}
              >
                {AXIS_LABEL[axis]}
              </button>
            </li>
          );
        })}
      </ul>

      <p
        className={cn(
          "type-caption",
          invalid ? "text-loss" : "text-muted-foreground",
        )}
      >
        {value.length === 0
          ? "None chosen — customers will only be asked the general questions."
          : invalid
            ? "One on its own is not a profile. Pick at least two, or none."
            : `${value.length} of ${MIN_AXES}–${MAX_AXES} chosen. “Just right” means your recipe as you wrote it.`}
      </p>
    </div>
  );
}
