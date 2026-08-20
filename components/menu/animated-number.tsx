"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Money and margins that travel to their new value instead of snapping.
 *
 * Deliberately a 12-line rAF tween rather than a number library: the digits
 * must sit in the tabular face so they don't jitter mid-flight, and a
 * dependency that server-renders its own markup already cost us a hydration
 * mismatch once in this project.
 *
 * Reduced motion gets the destination immediately — the value is the point,
 * the travel is the flourish.
 *
 * The tween is decoration and is treated as such: a timer guarantees the
 * destination lands even when no frame ever arrives. Browsers suspend
 * requestAnimationFrame in a background tab, so without this a chef who
 * switched tabs mid-edit would come back to a costing that silently kept the
 * old number. A stale figure on this screen is a lie, and no flourish is
 * worth one.
 */
function useAnimatedNumber(value: number, durationMs = 200): number {
  const [shown, setShown] = React.useState(value);
  // What is on screen right now, so an interrupted tween resumes from where
  // the digits actually are rather than jumping back to its old origin.
  const shownRef = React.useRef(value);

  React.useEffect(() => {
    const land = (n: number) => {
      shownRef.current = n;
      setShown(n);
    };
    const from = shownRef.current;
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || from === value || document.hidden) {
      land(value);
      return;
    }

    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // --ease-out, the same curve everything else enters on.
      const eased = 1 - Math.pow(1 - t, 3);
      land(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // The backstop. Timers still fire in a hidden tab; frames do not.
    const settle = setTimeout(() => land(value), durationMs + 60);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [value, durationMs]);

  return shown;
}

/** Money, always 2dp with the symbol, negatives red AND parenthesised. */
export function AnimatedMoney({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  const value = useAnimatedNumber(cents);
  // Half a cent, not zero: mid-tween a value crossing zero would otherwise
  // flash red and parenthesised for a frame on its way up.
  const negative = value < -0.5;
  const text = `$${(Math.abs(value) / 100).toFixed(2)}`;
  return (
    <span className={cn(negative && "text-loss", className)}>
      {negative ? `(${text})` : text}
    </span>
  );
}

/** Margins: 0dp with the % sign (DESIGN.md §4). A margin goes negative the
 * moment cost passes price — the single worst thing this app has to tell her
 * — so it takes the loss colour on top of its minus sign. The sign is what
 * survives a greyscale WhatsApp screenshot; the colour is what catches the
 * eye first. */
export function AnimatedPercent({
  percent,
  className,
}: {
  percent: number;
  className?: string;
}) {
  const rounded = Math.round(useAnimatedNumber(percent));
  return (
    <span className={cn(rounded < 0 && "text-loss", className)}>
      {rounded}%
    </span>
  );
}

/** Grams, for the unit weight she watches shrink as yield rises. */
export function AnimatedGrams({
  milligrams,
  className,
}: {
  milligrams: number;
  className?: string;
}) {
  const live = useAnimatedNumber(milligrams);
  return <span className={className}>{Math.round(live / 1000)} g</span>;
}
