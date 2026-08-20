import type { FeedbackWarning } from "./optimiser";

/**
 * What portion complaints say about a SIZE, rather than about an item.
 *
 * The optimiser's yield lever can cut a product until it is not worth buying.
 * Until now the only thing standing in its way said "2 of the last 2 said it
 * was too small" — true, but silent about which size those two ate, so it
 * could not argue against a specific yield. This module makes it specific.
 *
 * It is pure and free of Convex because this is where a silent lie would live,
 * and the lie has a precise shape: a denominator built from the ratings we
 * happened to be able to trace, presented as though it were all of them.
 *
 * Four rules.
 *
 * 1. **ONE BATCH OR NOTHING.** A rating counts toward a yield only when its
 *    order maps to exactly one production log for that item. Two candidate
 *    batches at two yields is not a fifty-fifty guess, it is an unknown.
 * 2. **THE UNTRACEABLE COUNT TRAVELS WITH EVERY CLAIM.** A figure that hides
 *    its own coverage is worse than no figure: she would act on "4 of 5"
 *    without knowing three more ratings exist that nobody could place.
 * 3. **NOTHING IS INFERRED FROM TODAY'S YIELD.** `menuItems.baseBatchYield` is
 *    overwritten in place with no history, so reading it for a rating from
 *    last month would assume away the very change being measured. Yield comes
 *    only from `expectedYieldMilli / batchCount` on the log that made the food.
 * 4. **NO CAUSE, NO PROPOSAL.** The after-override report states the two
 *    things Sous measures — complaints and margin — before and after. It never
 *    names a cause and never proposes a yield. Units sold is deliberately
 *    absent: "orders fell after you cut finer" is an elasticity claim wearing
 *    a fact's clothes, and CONTEXT.md forbids exactly that sentence.
 */

/** The two "too small" buckets on the portionSize axis: −2 and −1. */
const TOO_SMALL_VALUES = [-2, -1];

export interface PortionRating {
  orderId: string;
  /** −2..+2 on the portionSize axis. */
  value: number;
  receivedAt: number;
}

export interface BatchFact {
  productionLogId: string;
  orderIds: string[];
  /** Recovered as expectedYieldMilli / batchCount / 1000 by the caller — the
   * one place a past `baseBatchYield` survives. */
  yieldUnits: number;
  batchCount: number;
  producedAt: number;
}

export interface YieldEvidence {
  yieldUnits: number;
  /** Ratings at −2 or −1 traced to a batch cut at this yield. */
  saidTooSmall: number;
  /** Every rating traced to this yield. The denominator, and it is only ever
   * the traced ones. */
  n: number;
  /** "4 of 5 said it was too small." */
  sentence: string;
}

export interface PortionEvidence {
  /** Ascending by yield, and only yields that actually have ratings. */
  byYield: YieldEvidence[];
  /**
   * Ratings that exist and could not be tied to one batch — no log claimed the
   * order, or two did. Printed beside every claim (rule 2).
   */
  untraceable: number;
  /** Yields where at least one person said too small. Drives the chart marks;
   * a yield nobody complained about is never implicated. */
  complainedYields: number[];
  /** Traced + untraceable. What she would count by hand. */
  total: number;
}

// --- Tracing ---------------------------------------------------------------

export function evidenceFor(
  ratings: PortionRating[],
  batches: BatchFact[],
): PortionEvidence {
  // Which batches claim each order. More than one is an unknown, not a
  // fifty-fifty (rule 1).
  const claimants = new Map<string, BatchFact[]>();
  for (const batch of batches) {
    for (const orderId of batch.orderIds) {
      const bucket = claimants.get(orderId);
      if (bucket) bucket.push(batch);
      else claimants.set(orderId, [batch]);
    }
  }

  const byYield = new Map<number, { saidTooSmall: number; n: number }>();
  let untraceable = 0;

  for (const rating of ratings) {
    const candidates = claimants.get(rating.orderId);
    if (!candidates || candidates.length !== 1) {
      untraceable += 1;
      continue;
    }
    const { yieldUnits } = candidates[0];
    const row = byYield.get(yieldUnits) ?? { saidTooSmall: 0, n: 0 };
    row.n += 1;
    if (TOO_SMALL_VALUES.includes(Math.round(rating.value))) {
      row.saidTooSmall += 1;
    }
    byYield.set(yieldUnits, row);
  }

  const rows: YieldEvidence[] = [...byYield.entries()]
    .map(([yieldUnits, row]) => ({
      yieldUnits,
      saidTooSmall: row.saidTooSmall,
      n: row.n,
      sentence: yieldSentence(row.saidTooSmall, row.n),
    }))
    .sort((a, b) => a.yieldUnits - b.yieldUnits);

  return {
    byYield: rows,
    untraceable,
    complainedYields: rows.filter((r) => r.saidTooSmall > 0).map((r) => r.yieldUnits),
    total: ratings.length,
  };
}

/**
 * "4 of 5 said it was too small."
 *
 * The denominator is always present — that is the sample size DESIGN.md
 * requires beside every claim, and it is the difference between "4 people
 * complained" and "4 of 5 people complained", which are not the same fact.
 */
function yieldSentence(saidTooSmall: number, n: number): string {
  if (saidTooSmall === 0) {
    return n === 1
      ? "1 rating, and nobody called it small."
      : `${n} ratings, and nobody called it small.`;
  }
  return `${saidTooSmall} of ${n} said it was too small.`;
}

/** "3 more ratings could not be traced to a batch." Null when none were. */
export function coverageNote(evidence: PortionEvidence): string | null {
  if (evidence.untraceable === 0) return null;
  const n = evidence.untraceable;
  return `${n} more ${n === 1 ? "rating" : "ratings"} could not be traced to a batch, and ${n === 1 ? "is" : "are"} not in these figures.`;
}

// --- The warning -----------------------------------------------------------

/**
 * The specific constraint sentence, shown ALONGSIDE the arithmetic.
 *
 * Returns null rather than an empty shape whenever there is nothing to say, so
 * a kitchen with no feedback gets exactly the 1.3 optimiser back — which is
 * the acceptance criterion for this slice.
 */
export function warningFor(
  evidence: PortionEvidence,
  currentYield: number,
  suggestedYield: number | null,
  /** Yields she has already decided about at this size. Keyed by yield: a
   * different yield is a different decision (the only suppression rule). */
  overriddenYields: number[] = [],
): FeedbackWarning | null {
  // She has already considered this size and decided. The factual report takes
  // the warning's place; re-raising it would be Sous making the same point
  // twice, which is the "never says I told you so" rule.
  if (overriddenYields.includes(currentYield)) return null;

  const here = evidence.byYield.find((r) => r.yieldUnits === currentYield);
  if (!here || here.saidTooSmall === 0) return null;

  // Cutting finer makes each piece smaller, so a complaint at the current
  // size only argues against a HIGHER yield. Suggesting a coarser cut is not
  // something these ratings have anything to say about.
  const finer = suggestedYield != null && suggestedYield > currentYield;

  const detail = finer
    ? `${here.saidTooSmall} of ${here.n} said ${currentYield} a tray was already too small, and ${suggestedYield} cuts it smaller.`
    : `${here.saidTooSmall} of ${here.n} said ${currentYield} a tray was already too small.`;

  return {
    kind: "portionTooSmall",
    detail,
    sampleSize: here.n,
  };
}

// --- The after-override report ---------------------------------------------

export interface OverrideRecord {
  yieldUnits: number;
  decidedAt: number;
  saidTooSmallAtDecision: number;
  sampleAtDecision: number;
  grossMarginPercentAtDecision: number | null;
}

export interface OverrideReport {
  yieldUnits: number;
  decidedAt: number;
  /** What she was shown when she decided. Read off the stored row, never
   * recomputed — the point is to compare against what she actually saw. */
  before: { saidTooSmall: number; n: number; grossMarginPercent: number | null };
  /** Ratings received since, at this yield only. */
  since: { saidTooSmall: number; n: number; grossMarginPercent: number | null };
  /** Her words. Facts on both sides, no cause named, no yield proposed. */
  sentences: string[];
}

/**
 * "Since you moved to 15 on 4 Aug: 4 of 9 have said too small, against 1 of 9
 * before. Gross margin is 61%, up from 54%."
 *
 * There is deliberately NO units-sold figure anywhere in this shape. A quiet
 * month, a competitor and a wedding season all move that number, and putting
 * it beside a yield change asserts a connection by adjacency that Sous cannot
 * support (rule 4). The test asserts on the shape, not on the copy, so nobody
 * can add it back by editing a string.
 */
export function reportFor(
  ratings: PortionRating[],
  batches: BatchFact[],
  override: OverrideRecord,
  grossMarginPercentNow: number | null,
): OverrideReport {
  // Strictly AFTER, not at-or-after. A rating that landed on the same
  // instant as the decision was part of the evidence `record` stamped, so it
  // belongs to "before" — counting it twice would inflate "since" with a
  // rating she had already seen.
  const since = evidenceFor(
    ratings.filter((r) => r.receivedAt > override.decidedAt),
    batches,
  );
  const here = since.byYield.find((r) => r.yieldUnits === override.yieldUnits);
  const sinceRow = here ?? { saidTooSmall: 0, n: 0 };

  const sentences: string[] = [];
  if (sinceRow.n === 0) {
    sentences.push("Nobody has rated it at this size since.");
  } else {
    sentences.push(
      `${sinceRow.saidTooSmall} of ${sinceRow.n} have said it was too small since, against ${override.saidTooSmallAtDecision} of ${override.sampleAtDecision} before.`,
    );
  }
  if (grossMarginPercentNow != null) {
    const then = override.grossMarginPercentAtDecision;
    sentences.push(
      then == null
        ? `Gross margin is ${grossMarginPercentNow}%.`
        : then === grossMarginPercentNow
          ? `Gross margin is still ${grossMarginPercentNow}%.`
          : `Gross margin is ${grossMarginPercentNow}%, ${grossMarginPercentNow > then ? "up" : "down"} from ${then}%.`,
    );
  }

  return {
    yieldUnits: override.yieldUnits,
    decidedAt: override.decidedAt,
    before: {
      saidTooSmall: override.saidTooSmallAtDecision,
      n: override.sampleAtDecision,
      grossMarginPercent: override.grossMarginPercentAtDecision,
    },
    since: {
      saidTooSmall: sinceRow.saidTooSmall,
      n: sinceRow.n,
      grossMarginPercent: grossMarginPercentNow,
    },
    sentences,
  };
}
