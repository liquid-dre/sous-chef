import { formatMoney } from "@/components/numeric/money";

/**
 * Pantry display. Costs are stored as cents per 1000 base units; she thinks
 * in "per kg", "per litre", "each". Translate at the edge, never in her head.
 */

export type BaseUnit = "g" | "ml" | "unit";
export type PackUnit = "g" | "kg" | "ml" | "L" | "each" | "dozen";

/** What 1000 base units are called in her terms. */
export const THOUSAND_LABEL: Record<BaseUnit, string> = {
  g: "kg",
  ml: "L",
  unit: "1000",
};

export const FAMILY_LABEL: Record<BaseUnit, string> = {
  g: "weight",
  ml: "volume",
  unit: "count",
};

export const PACK_UNITS_FOR: Record<BaseUnit, PackUnit[]> = {
  g: ["g", "kg"],
  ml: ["ml", "L"],
  unit: ["each", "dozen"],
};

/**
 * "$1.85/kg", "$2.40/L", "$0.30 each" — always 2dp with the symbol, never
 * abbreviated (DESIGN.md §4).
 */
export function formatUnitPrice(
  centsPerThousand: number,
  baseUnit: BaseUnit,
): string {
  if (baseUnit === "unit") {
    // Stored per 1000; she buys them one at a time.
    const dollarsEach = centsPerThousand / 100 / 1000;
    // A genuinely sub-cent item would render "$0.00" at 2dp, which is a
    // number Sous cannot stand behind. Show the precision that makes it
    // true rather than a confident zero.
    if (dollarsEach > 0 && dollarsEach < 0.01) {
      return `$${dollarsEach.toFixed(4).replace(/0+$/, "")} each`;
    }
    return `${formatMoney(dollarsEach)} each`;
  }
  return `${formatMoney(centsPerThousand / 100)}/${THOUSAND_LABEL[baseUnit]}`;
}

/** Milli-base-units back to something readable: "2 kg", "500 g", "30 eggs". */
export function formatQty(qtyMilli: number, baseUnit: BaseUnit): string {
  const base = qtyMilli / 1000;
  if (baseUnit === "unit") {
    return `${trim(base)}${base === 1 ? "" : ""}`;
  }
  if (base >= 1000) return `${trim(base / 1000)} ${THOUSAND_LABEL[baseUnit]}`;
  return `${trim(base)} ${baseUnit}`;
}

/** How many base units one pack unit is. Mirrors convex/lib/drift.ts, which
 * is the authority — this is the display side of the same exact,
 * within-family arithmetic. */
const BASE_UNITS_PER: Record<PackUnit, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  L: 1000,
  each: 1,
  dozen: 12,
};

/**
 * Milli-base-units back into the unit she is typing in: 2,400,000 mg at "kg"
 * → "2.4".
 *
 * Trimmed rather than fixed-decimal, so a "matches" tap fills the field with
 * what she would have written herself — "2.4", not "2.4000".
 */
export function toTypedQty(qtyMilli: number, packUnit: PackUnit): string {
  return trim(qtyMilli / 1000 / BASE_UNITS_PER[packUnit]);
}

/** The unit a quantity is most naturally counted in: kg for a sack of flour,
 * g for a jar of cardamom. Chosen once from the expected amount, never as she
 * types — a field whose unit moves under her hand is unusable. */
export function naturalPackUnit(
  qtyMilli: number,
  baseUnit: BaseUnit,
): PackUnit {
  const [small, large] = PACK_UNITS_FOR[baseUnit];
  if (baseUnit === "unit") return small; // "each"; nobody counts in dozens
  return qtyMilli >= 1_000_000 ? large : small;
}

/** Signed, always with its sign and its unit: "−500 g", "+1.2 kg". */
export function formatVariance(varianceMilli: number, baseUnit: BaseUnit): string {
  if (varianceMilli === 0) return "matches";
  const sign = varianceMilli < 0 ? "−" : "+";
  return `${sign}${formatQty(Math.abs(varianceMilli), baseUnit)}`;
}

/** The pack as she typed it: "2 kg", "1 dozen". */
export function formatPack(packQtyMilli: number, packUnit: PackUnit): string {
  return `${trim(packQtyMilli / 1000)} ${packUnit}`;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Signed whole percent, always with its sign character. */
export function formatDriftPercent(percent: number): string {
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

/**
 * The age of a pantry figure, in her words.
 *
 * Never omitted. DESIGN.md §4: staleness is part of the number, and the
 * pantry level is arithmetic rather than a measurement until somebody counts
 * it — so "never counted" is stated outright rather than left as a blank that
 * reads like confidence.
 */
export function formatCountedAt(
  countedAt: number | null,
  now = Date.now(),
): string {
  if (countedAt === null) return "never counted";
  const days = Math.floor((now - countedAt) / 86_400_000);
  if (days <= 0) return "counted today";
  if (days === 1) return "counted yesterday";
  return `counted ${days} days ago`;
}

/** "set 4 March", "set today" — standard cost always shows its age. */
export function formatSetAt(setAt: number, now = Date.now()): string {
  const days = Math.floor((now - setAt) / 86_400_000);
  if (days <= 0) return "set today";
  if (days === 1) return "set yesterday";
  if (days < 30) return `set ${days} days ago`;
  return `set ${new Date(setAt).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}
