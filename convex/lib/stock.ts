/**
 * What is in the pantry, and how much Sous is willing to stand behind it.
 *
 * Two ideas, and the whole slice is downstream of them.
 *
 * 1. **Nothing stores a level.** How much flour there is = the last physical
 *    COUNT, plus every movement since. A stored number would mean a
 *    read-modify-write on every purchase and every batch; two batches racing
 *    on the same flour would both read 10kg, both write their own answer, and
 *    one deduction would vanish silently and permanently. Sums of inserts
 *    cannot lose a write — the argument convex/payments.ts already makes about
 *    money, applied to flour.
 *
 * 2. **The count wins.** She stood in the pantry and looked. A purchase
 *    back-entered afterwards but dated before the count is still recorded in
 *    full — cost drift needs it — but it cannot move a level a physical count
 *    already superseded. Otherwise entering last Tuesday's receipt on Friday
 *    would silently inflate a number she measured with her own eyes.
 *
 * Everything here is pure: no Convex, no clock, no timezone. The domain day
 * always arrives from the caller, because the server has no "today"
 * (convex runs UTC — see lib/day.ts).
 */

// --- The level ------------------------------------------------------------

export interface Anchor {
  /** What she counted. Milli-base-units. */
  countedQtyMilli: number;
  /** The instant of the count. */
  takenAt: number;
}

export interface Movement {
  deltaMilli: number;
  occurredAt: number;
}

/**
 * The count, plus what happened after it.
 *
 * STRICTLY after. The stocktake appends its own variance movement stamped at
 * `takenAt`; an inclusive comparison would add that variance on top of the
 * counted figure and report the discrepancy twice.
 *
 * With no anchor the whole ledger sums, which is the honest answer rather
 * than a fallback: a kitchen that has never counted has nothing better than
 * its own arithmetic, and Sous says so beside the number instead of implying
 * a confidence it does not have.
 */
export function levelFrom(
  anchor: Anchor | null,
  movements: readonly Movement[],
): number {
  let total = anchor ? anchor.countedQtyMilli : 0;
  for (const m of movements) {
    if (anchor && m.occurredAt <= anchor.takenAt) continue;
    total += m.deltaMilli;
  }
  return total;
}

export interface LedgerRow<T extends Movement> {
  movement: T;
  /** The level immediately after this movement. */
  runningMilli: number;
  /**
   * True for movements the anchor superseded. Shown struck through rather
   * than hidden: a back-dated receipt she entered IS in the pantry's history
   * even though it no longer moves the number, and quietly dropping it would
   * make the ledger fail to explain itself.
   */
  superseded: boolean;
}

/**
 * The arithmetic behind the number, oldest first.
 *
 * DESIGN.md §4 makes a derived figure with no breakdown a defect, and this is
 * the largest derived figure in Sous. Sorting happens here so no caller has
 * to remember to.
 */
export function runningLedger<T extends Movement>(
  anchor: Anchor | null,
  movements: readonly T[],
): LedgerRow<T>[] {
  const ordered = [...movements].sort((a, b) => a.occurredAt - b.occurredAt);
  let running = anchor ? anchor.countedQtyMilli : 0;
  return ordered.map((movement) => {
    const superseded = anchor !== null && movement.occurredAt <= anchor.takenAt;
    if (!superseded) running += movement.deltaMilli;
    return { movement, runningMilli: running, superseded };
  });
}

// --- Freshness ------------------------------------------------------------

/** Weekly is the cadence CONTEXT.md sets, so a fortnight without a receipt is
 * two shops Sous has not seen. Past that the level is arithmetic about
 * deliveries it may know nothing about. */
export const PURCHASE_STALE_DAYS = 14;

/** Two consecutive missed counts. Not three, not a month: at weekly cadence
 * this is a fortnight of unverified arithmetic, which is where the estimate
 * stops being worth acting on. */
export const MISSED_COUNTS_FOR_DORMANT = 2;

const MS_PER_DAY = 86_400_000;

/** Days from a "YYYY-MM-DD" to the epoch. Pure string arithmetic through
 * Date.UTC, so no timezone enters and no local date is constructed. */
export function epochDayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY);
}

/** 1970-01-01 was a Thursday; Sunday = 0 to match Date#getDay and
 * orgs.stocktakeDay. */
function weekdayOfEpochDay(n: number): number {
  return (((n + 4) % 7) + 7) % 7;
}

/**
 * How many times her chosen weekday has come and gone since the last count.
 *
 * Both ends excluded. The day she counted on is not a day she missed — and
 * today's stocktake, if today is the day, is DUE rather than missed. She has
 * until the end of it.
 */
export function missedCountsBetween(
  lastCountedOn: string,
  today: string,
  stocktakeDay: number | null,
): number {
  const from = epochDayOf(lastCountedOn) + 1;
  const to = epochDayOf(today) - 1;
  if (to < from) return 0;
  if (stocktakeDay === null) {
    // No day chosen yet. Weekly is still the cadence, so count whole weeks —
    // which lands on the same fortnight the explicit schedule does.
    return Math.floor((to - from + 1) / 7);
  }
  const offset = (((stocktakeDay - weekdayOfEpochDay(from)) % 7) + 7) % 7;
  const first = from + offset;
  if (first > to) return 0;
  return Math.floor((to - first) / 7) + 1;
}

export type Confidence = "neverCounted" | "fresh" | "stale" | "dormant";

export interface ConfidenceInput {
  /** Her local day of the most recent stocktake. Null = never counted. */
  lastCountedOn: string | null;
  /** Her local day of the most recent purchase logged. Null = nothing ever
   * bought, which is not staleness — there is simply no pantry yet. */
  lastPurchaseOn: string | null;
  today: string;
  stocktakeDay: number | null;
}

export interface ConfidenceState {
  state: Confidence;
  missedCounts: number;
  daysSinceCount: number | null;
  daysSincePurchase: number | null;
  /** True when it is stale because of the receipts rather than the counting.
   * The two need different sentences — one asks her to log a shop, the other
   * to walk the pantry. */
  purchaseLoggingStale: boolean;
}

/**
 * fresh → stale → dormant, and the fourth state that is not on that ladder.
 *
 * Dormant is the one that matters. Two missed counts means the level is a
 * fortnight of unverified arithmetic, and CONTEXT.md is explicit that Sous
 * says so plainly rather than quietly continuing to print a number. Alerts go
 * dormant with it: an alert derived from a figure nobody has confirmed is
 * worse than no alert, because it spends the trust that makes the honest ones
 * work.
 *
 * `neverCounted` is deliberately not "very stale". A kitchen that has never
 * taken a stocktake is not decaying — it has an estimate built entirely from
 * receipts and recipes, which is a different claim needing different words.
 */
export function confidenceOf(input: ConfidenceInput): ConfidenceState {
  const todayIndex = epochDayOf(input.today);
  const daysSinceCount =
    input.lastCountedOn === null
      ? null
      : todayIndex - epochDayOf(input.lastCountedOn);
  const daysSincePurchase =
    input.lastPurchaseOn === null
      ? null
      : todayIndex - epochDayOf(input.lastPurchaseOn);
  const purchaseLoggingStale =
    daysSincePurchase !== null && daysSincePurchase >= PURCHASE_STALE_DAYS;

  const missedCounts =
    input.lastCountedOn === null
      ? 0
      : missedCountsBetween(input.lastCountedOn, input.today, input.stocktakeDay);

  let state: Confidence;
  if (input.lastCountedOn === null) {
    state = "neverCounted";
  } else if (missedCounts >= MISSED_COUNTS_FOR_DORMANT) {
    state = "dormant";
  } else if (missedCounts > 0 || purchaseLoggingStale) {
    // Stale receipts soften confidence without killing it: she may well know
    // exactly what is on the shelf, but Sous has not been told about any
    // deliveries for a fortnight and cannot claim otherwise.
    state = "stale";
  } else {
    state = "fresh";
  }

  return {
    state,
    missedCounts,
    daysSinceCount,
    daysSincePurchase,
    purchaseLoggingStale,
  };
}

/** Is today the day she counts? Drives the reminder and the calendar slice
 * that will read this rather than inventing its own. */
export function stocktakeDueOn(today: string, stocktakeDay: number | null): boolean {
  if (stocktakeDay === null) return false;
  return weekdayOfEpochDay(epochDayOf(today)) === stocktakeDay;
}

// --- Sub-recipes ----------------------------------------------------------

export interface SubRecipeLine {
  subMenuItemId: string;
  name: string;
  /** Milli-units of the sub, per ONE base batch of the parent. */
  qtyMilliPerBatch: number;
  /** Finished units of the sub currently on the shelf, milli-units. */
  onHandMilli: number;
  /** Units one batch of the sub yields. */
  baseBatchYield: number;
}

export interface SubRecipeShortfall {
  subMenuItemId: string;
  name: string;
  neededMilli: number;
  onHandMilli: number;
  shortMilli: number;
  /** Whole batches, because CONTEXT.md says she makes whole batches — half a
   * tray of buttercream is not a thing she can log. */
  batchesToCover: number;
}

/**
 * Which sub-recipes this bake would run out of.
 *
 * DIRECT LINES ONLY, and that is a decision rather than a limitation. A
 * sub-recipe line draws on the SUB's finished stock; recursing into its raw
 * ingredients would move flour and butter with no production log behind them,
 * so the buttercream batch would have no cost snapshot, no yield variance and
 * no overhang — the three things a production log exists to record
 * (CONTEXT.md — Pantry). Instead Sous notices the gap and offers to log the
 * sub's batch too, which deducts the leaves the honest way.
 */
export function subRecipeShortfalls(
  lines: readonly SubRecipeLine[],
  batchCount: number,
): SubRecipeShortfall[] {
  const out: SubRecipeShortfall[] = [];
  for (const line of lines) {
    const neededMilli = Math.round(line.qtyMilliPerBatch * batchCount);
    const shortMilli = neededMilli - line.onHandMilli;
    if (shortMilli <= 0) continue;
    // A sub that yields nothing cannot cover anything; one batch is the
    // honest suggestion rather than Infinity.
    const yieldUnits = line.baseBatchYield > 0 ? line.baseBatchYield : 1;
    out.push({
      subMenuItemId: line.subMenuItemId,
      name: line.name,
      neededMilli,
      onHandMilli: line.onHandMilli,
      shortMilli,
      batchesToCover: Math.max(1, Math.ceil(shortMilli / 1000 / yieldUnits)),
    });
  }
  return out;
}
