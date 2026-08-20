/**
 * Cost drift, as pure arithmetic. No Convex imports — this file is unit
 * tested directly, and every rule that decides whether Sous speaks up lives
 * here rather than scattered through queries.
 *
 * Drift is DERIVED, never stored (see the slice plan): adopt the median and
 * the signal disappears because the inputs changed, not because a row was
 * resolved. The 90-day staleness nudge is a function of the clock, which no
 * purchase event would ever fire.
 */

/** Units families are sealed. Nothing converts between them, ever. */
export type BaseUnit = "g" | "ml" | "unit";
export type PackUnit = "g" | "kg" | "ml" | "L" | "each" | "dozen";

/** Which family a pack unit belongs to, and how many base units it is. */
const PACK_UNITS: Record<PackUnit, { family: BaseUnit; baseUnits: number }> = {
  g: { family: "g", baseUnits: 1 },
  kg: { family: "g", baseUnits: 1000 },
  ml: { family: "ml", baseUnits: 1 },
  L: { family: "ml", baseUnits: 1000 },
  each: { family: "unit", baseUnits: 1 },
  dozen: { family: "unit", baseUnits: 12 },
};

export function packUnitsFor(baseUnit: BaseUnit): PackUnit[] {
  return (Object.keys(PACK_UNITS) as PackUnit[]).filter(
    (u) => PACK_UNITS[u].family === baseUnit,
  );
}

export function isPackUnitCompatible(
  packUnit: PackUnit,
  baseUnit: BaseUnit,
): boolean {
  return PACK_UNITS[packUnit].family === baseUnit;
}

/** "2 kg" → 2,000,000 milli-grams. Exact within-family arithmetic only. */
export function toBaseMilli(packQtyMilli: number, packUnit: PackUnit): number {
  return Math.round(packQtyMilli * PACK_UNITS[packUnit].baseUnits);
}

/**
 * Cents per 1000 base units — per kg, per litre, or per 1000 count.
 * Rounded, for display and the drift median only; costing math always
 * recomputes from the exact priceCents / qtyBaseMilli pair.
 */
export function unitPriceCentsPerThousand(
  priceCents: number,
  qtyBaseMilli: number,
): number {
  if (qtyBaseMilli <= 0) return 0;
  // priceCents per qtyBaseMilli milli-units → per 1000 whole base units,
  // i.e. per 1,000,000 milli-units.
  return Math.round((priceCents * 1_000_000) / qtyBaseMilli);
}

/** The median of the last N (default 3) prices, newest first or last —
 * order-independent, because we sort. One emergency corner-shop run at
 * double price cannot move a median of three; three consecutive high
 * prices must. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Purchases must arrive newest-first (the by_org_ingredient_time index
 * read in descending order). */
export function medianOfLastN(
  unitPrices: number[],
  n = MIN_PURCHASES_FOR_DRIFT,
): number {
  return median(unitPrices.slice(0, n));
}

/** CONTEXT.md: below three purchases no drift signal exists — not a
 * softened warning, nothing. Silence is honest when the evidence is thin. */
export const MIN_PURCHASES_FOR_DRIFT = 3;

/** An ingredient priced longer ago than this is nudged regardless of
 * purchase data, because the failure mode is silence, not wrong data. */
export const STALE_AFTER_DAYS = 90;
const DAY_MS = 86_400_000;

export type DriftSeverity = "none" | "amber" | "red";

export interface DriftInput {
  standardCostCentsPerThousand: number;
  standardCostSetAt: number;
  /** Newest first. */
  recentUnitPrices: number[];
  /** Org threshold, whole percent (default 10). */
  thresholdPercent: number;
  now: number;
}

export interface Drift {
  /** Null when fewer than three purchases exist — no signal, by design. */
  medianCentsPerThousand: number | null;
  standardCentsPerThousand: number;
  /** Signed whole percent the median sits above/below standard cost. */
  percent: number | null;
  severity: DriftSeverity;
  /** Past the org threshold. */
  drifted: boolean;
  /** Standard cost older than 90 days — independent of purchase data. */
  stale: boolean;
  staleDays: number;
  purchaseCount: number;
  hasEnoughData: boolean;
}

export function driftFor(input: DriftInput): Drift {
  const {
    standardCostCentsPerThousand: standard,
    standardCostSetAt,
    recentUnitPrices,
    thresholdPercent,
    now,
  } = input;

  const staleDays = Math.floor((now - standardCostSetAt) / DAY_MS);
  const stale = staleDays >= STALE_AFTER_DAYS;
  const hasEnoughData = recentUnitPrices.length >= MIN_PURCHASES_FOR_DRIFT;

  if (!hasEnoughData || standard <= 0) {
    return {
      medianCentsPerThousand: null,
      standardCentsPerThousand: standard,
      percent: null,
      severity: "none",
      drifted: false,
      stale,
      staleDays,
      purchaseCount: recentUnitPrices.length,
      hasEnoughData: false,
    };
  }

  const medianCents = medianOfLastN(recentUnitPrices);
  const percent = Math.round(((medianCents - standard) / standard) * 100);
  const magnitude = Math.abs(percent);
  const drifted = magnitude >= thresholdPercent;
  const severity: DriftSeverity = !drifted
    ? "none"
    : magnitude >= thresholdPercent * 2
      ? "red"
      : "amber";

  return {
    medianCentsPerThousand: medianCents,
    standardCentsPerThousand: standard,
    percent,
    severity,
    drifted,
    stale,
    staleDays,
    purchaseCount: recentUnitPrices.length,
    hasEnoughData: true,
  };
}

/** Does this ingredient warrant saying anything at all? */
export function needsAttention(drift: Drift, alertsMuted: boolean): boolean {
  return !alertsMuted && (drift.drifted || drift.stale);
}

// --- Menu-item impact -----------------------------------------------------

/** A recipe flattened to the ingredient quantities one base batch consumes,
 * with the sub-recipe path that led to each (for "via Buttercream"). */
export interface FlatIngredientUse {
  ingredientId: string;
  qtyMilli: number;
  /** Names of the sub-recipes traversed, outermost first. Empty = direct. */
  viaPath: string[];
}

export interface CostedLayers {
  ingredientsCents: number;
  perUnitExtrasCents: number;
  overheadCents: number;
}

/**
 * Ingredient cost for one base batch, at a given per-1000 price for each
 * ingredient. Quantities are milli-base-units, prices are cents per 1000
 * base units, so cents = qtyMilli × price / 1,000,000.
 */
export function ingredientsCostCents(
  uses: FlatIngredientUse[],
  priceCentsPerThousand: (ingredientId: string) => number,
): number {
  return uses.reduce(
    (sum, use) =>
      sum +
      (use.qtyMilli * priceCentsPerThousand(use.ingredientId)) / 1_000_000,
    0,
  );
}

export interface MarginPair {
  grossPercent: number;
  netPercent: number;
}

/** Gross is against variable cost (layers 1+2); net against all three.
 * Both are always surfaced — neither substitutes for the other. */
export function marginsFor(
  priceCents: number,
  layers: CostedLayers,
): MarginPair {
  if (priceCents <= 0) return { grossPercent: 0, netPercent: 0 };
  const variable = layers.ingredientsCents + layers.perUnitExtrasCents;
  const all = variable + layers.overheadCents;
  return {
    grossPercent: Math.round(((priceCents - variable) / priceCents) * 100),
    netPercent: Math.round(((priceCents - all) / priceCents) * 100),
  };
}

export interface MenuItemImpact {
  /** Margins as costed today, against standard costs. */
  now: MarginPair;
  /** Margins if EVERY drifted ingredient in this item were adopted at once —
   * never one at a time, which would show several contradictory "new"
   * margins for the same cake. */
  ifAdopted: MarginPair;
  targetGrossPercent: number | null;
  /** True when adopting would take gross below the item's own target. */
  fallsBelowTarget: boolean;
}

export function menuItemImpact(args: {
  priceCents: number;
  targetGrossPercent: number | null;
  uses: FlatIngredientUse[];
  perUnitExtrasCents: number;
  overheadCents: number;
  standardPrice: (ingredientId: string) => number;
  /** Median price for drifted ingredients; falls back to standard. */
  adoptedPrice: (ingredientId: string) => number;
}): MenuItemImpact {
  const base = {
    perUnitExtrasCents: args.perUnitExtrasCents,
    overheadCents: args.overheadCents,
  };
  const now = marginsFor(args.priceCents, {
    ...base,
    ingredientsCents: ingredientsCostCents(args.uses, args.standardPrice),
  });
  const ifAdopted = marginsFor(args.priceCents, {
    ...base,
    ingredientsCents: ingredientsCostCents(args.uses, args.adoptedPrice),
  });
  return {
    now,
    ifAdopted,
    targetGrossPercent: args.targetGrossPercent,
    fallsBelowTarget:
      args.targetGrossPercent !== null &&
      now.grossPercent >= args.targetGrossPercent &&
      ifAdopted.grossPercent < args.targetGrossPercent,
  };
}
