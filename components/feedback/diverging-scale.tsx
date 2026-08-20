"use client";

import * as React from "react";
import { AXIS_LABEL, AXIS_SCALE, type SensoryAxis } from "@/convex/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * The five-point diverging scale. The hard component, and the one that biases
 * every data point Sous will ever collect.
 *
 * Three things it must get right, in order of how expensive they are to get
 * wrong:
 *
 * 1. **NOTHING IS PRE-SELECTED.** The midpoint is the resting POSITION, not the
 *    default VALUE. Pre-selecting "just right" would manufacture agreement from
 *    everyone who scrolled past — and because the readout counts people, that
 *    invented agreement would be indistinguishable from the real thing.
 * 2. **THE MIDPOINT IS LABELLED, not merely centred.** "Just right" is written
 *    under the middle option. A row of five dots with the ends labelled leaves
 *    the reader to infer that the middle means neutral, and a scale answered on
 *    an inference is a scale answered carelessly.
 * 3. **BOTH ENDS ARE NAMED.** "Too sweet" and "not sweet enough" are opposite
 *    fixes (CONTEXT.md), so the two directions must be legible without moving.
 *
 * Tapping the selected option again CLEARS it. She is recording a
 * half-remembered comment: "I think they said something about the sweetness"
 * is a thing she may start and then decide she cannot stand behind, and there
 * has to be a way back to having said nothing.
 */

const VALUES = [-2, -1, 0, 1, 2] as const;

export function DivergingScale({
  axis,
  value,
  onChange,
  /** Distinguishes multiple scales for the same axis on one page. */
  idPrefix = "",
}: {
  axis: SensoryAxis;
  value: number | null;
  onChange: (value: number | null) => void;
  idPrefix?: string;
}) {
  const labels = AXIS_SCALE[axis];
  const name = `${idPrefix}${axis}`;

  // Arrow keys walk the scale. Roving tabindex so the group is ONE tab stop —
  // five stops per axis would make a four-axis form twenty tabs deep.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = Math.max(-2, Math.min(2, (value ?? 0) + delta));
    onChange(next);
  };

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="type-label">{AXIS_LABEL[axis]}</legend>

      <div
        role="radiogroup"
        aria-label={AXIS_LABEL[axis]}
        onKeyDown={onKeyDown}
        className="flex items-stretch justify-between gap-1"
      >
        {VALUES.map((option) => {
          const selected = value === option;
          const middle = option === 0;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={labels[option + 2]}
              name={name}
              // Roving: the selected one, or the midpoint when nothing is
              // chosen — so a keyboard lands where the scale rests.
              tabIndex={selected || (value === null && middle) ? 0 : -1}
              // Tap again to clear. Starting an answer she cannot stand behind
              // has to be reversible.
              onClick={() => onChange(selected ? null : option)}
              className={cn(
                "group flex min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-md py-1 outline-none",
                "transition-[background-color,border-color] duration-[var(--duration-fast)] ease-out",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                selected ? "bg-primary-soft" : "hover:bg-muted",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "block rounded-full border-2 transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-out",
                  // The midpoint is physically bigger. It is the resting
                  // position, and it should look like one at a glance.
                  middle ? "size-5" : "size-4",
                  selected
                    ? "scale-100 border-primary bg-primary"
                    : "border-muted-foreground/40 group-active:scale-[0.9]",
                )}
              />
            </button>
          );
        })}
      </div>

      {/* Both directions named, and the midpoint labelled under the middle —
          never left to be inferred from position. */}
      <div className="flex items-start justify-between gap-2">
        <span className="type-caption flex-1 text-muted-foreground">{labels[0]}</span>
        <span className="type-caption flex-1 text-center font-medium">Just right</span>
        <span className="type-caption flex-1 text-right text-muted-foreground">
          {labels[4]}
        </span>
      </div>

      {/*
        What was actually picked, in words. A dot on a row is not a record;
        reading it back is how she knows the tap landed where she meant.

        EMPTY until something is chosen, with the space still reserved. The
        browser showed four stacked "Not said" lines on the public form before
        the customer had touched anything — four repetitions of a fact the
        unfilled dots already state, on the one screen whose whole budget is
        thirty seconds. The element stays mounted so aria-live still announces
        the first selection and the layout does not jump.
      */}
      <p aria-live="polite" className="type-caption min-h-4">
        {value === null ? "" : labels[value + 2]}
      </p>
    </fieldset>
  );
}
