import { median } from "./drift";
import type { Confidence } from "./stock";

/**
 * Alerts that look forward at the order book, never backward at levels alone.
 *
 * "Milk is low" is a fact about a shelf. "3 orders before Sunday need 4
 * batches and you have milk for 1" names the failure AND its date, and that
 * difference is the whole feature (CONTEXT.md — Pantry).
 *
 * Three rules shape every function here, and all three exist to stop one
 * outcome. CONTEXT.md: "A wrong red alert twice and she mutes the system
 * forever." Everything below is a defence against being confidently wrong.
 *
 * 1. **Red is only ever arithmetic on confirmed orders.** "You have three
 *    orders and enough milk for one" is a fact Sous can stand behind on day
 *    one with no history whatsoever. Amber is where the estimate lives —
 *    typical weekly usage, the horizon past the order book — and an estimate
 *    is never allowed to raise a red.
 * 2. **The demand half never hedges; only the supply half carries its age.**
 *    What the orders need is true regardless of when the pantry was last
 *    counted. What is on the shelf is exactly the thing that goes stale.
 * 3. **Degradation removes confidence, not information.** A stale pantry
 *    demotes red to amber and states the age inline. It does not hide the
 *    number, because DESIGN.md §4 bans a number whose staleness is UNKNOWN,
 *    not one whose staleness is stated.
 *
 * Pure: no Convex, no clock. Her day always arrives as an argument, because
 * Convex runs UTC and the server has no "today" (lib/day.ts).
 */

// --- Constants ------------------------------------------------------------

/** The window. "3 orders THIS WEEK" — and it matches her rhythm: CONTEXT.md
 * has her shopping weekly and counting weekly. Beyond this she will have
 * shopped again, so charging today's pantry with that demand is pessimism
 * dressed as a warning. */
export const HORIZON_DAYS = 7;

/** Below this many weeks of consumption there is no "typical" to speak of,
 * so amber stays silent. Three is the same bar MIN_PURCHASES_FOR_DRIFT sets
 * before Sous will claim a price has moved. */
export const MIN_WEEKS_FOR_TYPICAL = 3;

/** How many weeks back the typical rate is measured over. Long enough to
 * survive one quiet week, short enough that a kitchen that has changed its
 * menu is not judged on the old one. */
export const USAGE_WINDOW_WEEKS = 8;

/** Amber when less than this many typical weeks remain beyond the booked
 * orders. One week, because that is exactly the gap to her next shop. */
export const AMBER_WEEKS = 1;

/** A resolved alert comes back when the shortfall worsens by more than this.
 * Borrowed verbatim from recommendations.RESURFACE_FRACTION and for the same
 * reason: every figure here moves a little every day, and without a threshold
 * "I have dealt with it" would mean "until tomorrow". */
export const RESURFACE_FRACTION = 0.25;

const MS_DAY = 86_400_000;

// --- Typical weekly usage -------------------------------------------------

export interface UsageMovement {
  ingredientId: string;
  /** Signed. Production movements are negative. */
  deltaMilli: number;
  occurredAt: number;
}

/**
 * What this kitchen typically gets through in a week, per ingredient.
 *
 * Measured from `stockMovements` where `reason === "production"` — the only
 * event that consumes the pantry, and already correct for sub-recipes because
 * a sub's own production log wrote its own movements. Nothing has to be
 * re-resolved through recipes to get this figure.
 *
 * MEDIAN, not mean: one enormous wedding order would drag a mean up and leave
 * amber permanently lit for months afterwards. The median asks what a normal
 * week looks like, which is the actual question.
 *
 * Returns nothing at all for an ingredient with fewer than
 * MIN_WEEKS_FOR_TYPICAL weeks of history. Absence means "Sous does not know",
 * and every caller must treat it that way rather than substituting zero.
 */
export function typicalWeeklyMilli(
  movements: readonly UsageMovement[],
  today: string,
  weeks = USAGE_WINDOW_WEEKS,
): Map<string, number> {
  const endMs = Date.parse(`${today}T00:00:00Z`) + MS_DAY - 1;
  const startMs = endMs - weeks * 7 * MS_DAY;

  // ingredientId -> weekIndex -> milli consumed
  const byIngredient = new Map<string, Map<number, number>>();
  for (const m of movements) {
    if (m.deltaMilli >= 0) continue; // only consumption
    if (m.occurredAt < startMs || m.occurredAt > endMs) continue;
    const weekIndex = Math.floor((endMs - m.occurredAt) / (7 * MS_DAY));
    let weeksMap = byIngredient.get(m.ingredientId);
    if (!weeksMap) {
      weeksMap = new Map();
      byIngredient.set(m.ingredientId, weeksMap);
    }
    weeksMap.set(weekIndex, (weeksMap.get(weekIndex) ?? 0) + Math.abs(m.deltaMilli));
  }

  const out = new Map<string, number>();
  for (const [ingredientId, weeksMap] of byIngredient) {
    // Weeks with no consumption count as zero rather than being skipped: an
    // ingredient used once a month is NOT one that gets through a batch a
    // week, and dropping the quiet weeks would claim exactly that.
    const observed = Math.min(weeks, Math.max(...weeksMap.keys()) + 1);
    if (observed < MIN_WEEKS_FOR_TYPICAL) continue;
    const series: number[] = [];
    for (let i = 0; i < observed; i += 1) series.push(weeksMap.get(i) ?? 0);
    const rate = median(series);
    if (rate > 0) out.set(ingredientId, rate);
  }
  return out;
}

// --- Runway ---------------------------------------------------------------

export interface RunwayInput {
  ingredientId: string;
  name: string;
  /** Derived from the ledger. */
  onHandMilli: number;
  /** What the confirmed orders inside the horizon will consume. */
  bookedMilli: number;
  /** Median week, or null when there is not enough history to say. */
  typicalWeeklyMilli: number | null;
}

export interface Runway {
  ingredientId: string;
  name: string;
  onHandMilli: number;
  bookedMilli: number;
  shortMilli: number;
  /**
   * Days until it runs out: the booked orders first, then typical usage
   * beyond the horizon. Null when there is no booked demand AND no history —
   * Sous genuinely cannot say, and a made-up number is worse than a gap.
   * Infinity is never returned; "nothing is consuming this" is `null` too.
   */
  daysOfCover: number | null;
  /** True when the confirmed orders alone cannot be covered. This is the
   * only thing permitted to raise a red. */
  bookedShort: boolean;
}

export function runwayFor(input: RunwayInput): Runway {
  const shortMilli = Math.max(0, input.bookedMilli - input.onHandMilli);
  const bookedShort = shortMilli > 0;

  let daysOfCover: number | null = null;
  if (bookedShort) {
    // It runs out INSIDE the horizon. Straight-line through the booked
    // demand, which is the honest reading: Sous knows the total the week
    // needs but not which day each batch is made.
    const perDay = input.bookedMilli / HORIZON_DAYS;
    daysOfCover = perDay > 0 ? Math.floor(input.onHandMilli / perDay) : null;
  } else {
    const leftoverMilli = input.onHandMilli - input.bookedMilli;
    if (input.typicalWeeklyMilli && input.typicalWeeklyMilli > 0) {
      // The booked week is covered; the rest is measured against a normal
      // week, which is an estimate and can therefore only ever raise amber.
      daysOfCover =
        HORIZON_DAYS + Math.floor((leftoverMilli / input.typicalWeeklyMilli) * 7);
    } else if (input.bookedMilli > 0) {
      // Booked demand but no history: Sous can say it covers the week and
      // nothing beyond it. Reporting the horizon itself is honest — the
      // alternative is claiming a runway it cannot see.
      daysOfCover = HORIZON_DAYS;
    }
  }

  return {
    ingredientId: input.ingredientId,
    name: input.name,
    onHandMilli: input.onHandMilli,
    bookedMilli: input.bookedMilli,
    shortMilli,
    daysOfCover,
    bookedShort,
  };
}

// --- Severity -------------------------------------------------------------

export type Severity = "red" | "amber";

/**
 * Red from the order book, amber from history. Never the other way round.
 *
 * `null` is a real answer and the most common one: nothing is wrong, or Sous
 * does not know enough to say anything it could stand behind. An alert that
 * fires on a guess is the thing this whole module is built to avoid.
 */
export function severityOf(runway: Runway, typicalWeekly: number | null): Severity | null {
  // A FACT: the orders she has taken cannot be covered by the food she has.
  // No history needed, so this works on a kitchen's first day.
  if (runway.bookedShort) return "red";

  // An ESTIMATE: past the booked orders, a normal week would exhaust it.
  // Silent without history rather than guessing a threshold.
  if (typicalWeekly && typicalWeekly > 0) {
    const leftoverMilli = runway.onHandMilli - runway.bookedMilli;
    if (leftoverMilli < typicalWeekly * AMBER_WEEKS) return "amber";
  }
  return null;
}

// --- Degradation ----------------------------------------------------------

export type PantryTrust = "trusted" | "hedged" | "dormant";

/**
 * How much the pantry figure is worth, from the four-state confidence the
 * stocktake slice computes (convex/lib/stock.ts).
 *
 * `neverCounted` sits with `stale` deliberately: an estimate built entirely
 * from receipts and recipes has never been confirmed by anybody looking at a
 * shelf, which is the same reason `stale` cannot carry a red.
 */
export function trustFrom(confidence: Confidence): PantryTrust {
  if (confidence === "fresh") return "trusted";
  if (confidence === "dormant") return "dormant";
  return "hedged";
}

/**
 * Demote a severity for a pantry Sous cannot fully vouch for.
 *
 * Red requires a trusted pantry, because red compares the order book against
 * the STOCK figure and that figure is exactly the stale thing. Amber survives
 * hedging — it was already an estimate and says so. Dormant returns null: the
 * caller replaces the whole per-ingredient list with one line, because eleven
 * hedged alerts built on a fortnight of unverified arithmetic is the same
 * trust leak as two wrong reds, only slower.
 */
export function degrade(severity: Severity | null, trust: PantryTrust): Severity | null {
  if (severity === null) return null;
  if (trust === "dormant") return null;
  if (trust === "hedged") return "amber";
  return severity;
}

// --- Resurfacing ----------------------------------------------------------

export interface Resolution {
  /** The shortfall she accepted, in milli. The whole reason the row exists. */
  shortfallAtResolutionMilli: number;
}

/**
 * Does a resolved alert come back?
 *
 * Mirrors recommendations.shouldResurface and reuses its threshold, on
 * quantity rather than money. She resolved the problem she was SHOWN — "I am
 * buying milk this afternoon" — not every milk problem this kitchen will ever
 * have. A materially worse shortfall is a different problem.
 */
export function shouldResurfaceAlert(
  resolution: Resolution,
  shortfallMilli: number,
): boolean {
  const base = Math.abs(resolution.shortfallAtResolutionMilli);
  // A shortfall appearing where there was none is material by definition, and
  // guarding the divide here is what stops it being a division by zero.
  if (base === 0) return shortfallMilli > 0;
  return (shortfallMilli - resolution.shortfallAtResolutionMilli) / base > RESURFACE_FRACTION;
}

// --- The horizon ----------------------------------------------------------

/** Inclusive last day of the window, from HER today. */
export function horizonEnd(today: string, days = HORIZON_DAYS): string {
  const end = Date.parse(`${today}T00:00:00Z`) + (days - 1) * MS_DAY;
  return new Date(end).toISOString().slice(0, 10);
}

/** Is this delivery date inside the window? Domain days compare as strings. */
export function withinHorizon(deliveryDate: string, today: string, days = HORIZON_DAYS): boolean {
  return deliveryDate >= today && deliveryDate <= horizonEnd(today, days);
}
