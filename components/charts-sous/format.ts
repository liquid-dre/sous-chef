import { formatMoney } from "@/components/numeric/money";

/**
 * Shared chart formatters (DESIGN.md §4/§5). All money enters in integer
 * CENTS — the schema's only money representation — and leaves as strings.
 *
 * Axis ticks MAY abbreviate ($1.2k) per DESIGN.md §4; tooltips NEVER do.
 * Negatives are parenthesised everywhere — colour alone fails colourblind
 * users and WhatsApp screenshots.
 */

/** Tooltip / anywhere she might act on the number: full 2dp, symbol. */
export function formatMoneyExact(cents: number): string {
  return formatMoney(cents / 100);
}

/** Y-axis tick labels: abbreviates at $10k+, otherwise exact. */
export function formatMoneyTick(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 1_000_000) {
    const compact = `$${(abs / 100_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}k`;
    return cents < 0 ? `(${compact})` : compact;
  }
  return formatMoneyExact(cents);
}

/** Margins: whole percent, always with the sign character. */
export function formatMarginTick(percent: number): string {
  return `${Math.round(percent)}%`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export const GRAIN_LABEL = {
  day: "daily totals",
  week: "weekly totals",
  month: "monthly totals",
} as const;

export type Grain = keyof typeof GRAIN_LABEL;
