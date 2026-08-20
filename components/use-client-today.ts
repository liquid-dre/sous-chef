"use client";

import * as React from "react";
import { today } from "@/lib/day";

/**
 * Today, from the browser's clock — and empty on the server.
 *
 * The two are genuinely different values, which is exactly what
 * `useSyncExternalStore` is for. Computing it during render would make a
 * kitchen in Harare at 00:30 render "yesterday" on the server against
 * "today" on the client: a hydration mismatch, and worse, an order filed to
 * the wrong day. Doing it in an effect trips `react-hooks/set-state-in-effect`
 * and causes a second render for no reason.
 *
 * Callers treat `""` as "not known yet" and skip whatever depends on it.
 */
const noop = () => () => {};

export function useClientToday(): string {
  return React.useSyncExternalStore(
    noop,
    () => today(),
    () => "",
  );
}
