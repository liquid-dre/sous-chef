import type { FeedbackWarning } from "./optimiser";

/**
 * What the customer said, aggregated on a scale that cannot collapse.
 *
 * Pure and free of Convex, because this is where a silent lie would live —
 * and the specific lie this file exists to prevent is averaging. "Too sweet"
 * and "not sweet enough" are OPPOSITE FIXES (CONTEXT.md — Feedback). Four
 * people saying +2 and four saying −2 average to exactly zero, which reads as
 * "everyone thought it was perfect" and is the precise opposite of the truth.
 *
 * Three rules shape the file.
 *
 * 1. **THE MEAN NEVER TRAVELS ALONE.** `meanRadarValue` exists because a radar
 *    polygon needs one number per axis and there is no way around that. It is
 *    therefore always emitted alongside the five bucket counts and a
 *    `splitBothWays` flag, and the sentence names both directions whenever
 *    both exist. A caller that renders the mean without the counts is a defect.
 * 2. **ONE DENOMINATOR, PROVENANCE STATED.** Her own logged notes and a
 *    customer's own slider share a count — the customer is the source either
 *    way, she is the recording instrument. But the sentence says which, and
 *    that matters most at the optimiser: a price warning built entirely from
 *    her own recollections is a self-confirming loop, and the only defence is
 *    saying so out loud.
 * 3. **THE MIDPOINT IS THE TARGET.** Picking an axis is the whole statement —
 *    it says this dimension matters and that her recipe as written is what
 *    "just right" means. There is no stored per-axis target and there must not
 *    be one, or "just right" would mean two different things on one scale.
 */

export type SensoryAxis =
  | "sweetness"
  | "moisture"
  | "richness"
  | "saltiness"
  | "heat"
  | "portionSize"
  | "doneness";

export type FeedbackFlag = "tooExpensive" | "late" | "packaging" | "lovedIt";

/** The library, in the order the picker shows it. */
export const SENSORY_AXES: SensoryAxis[] = [
  "sweetness",
  "moisture",
  "richness",
  "saltiness",
  "heat",
  "portionSize",
  "doneness",
];

export const AXIS_LABEL: Record<SensoryAxis, string> = {
  sweetness: "Sweetness",
  moisture: "Moisture",
  richness: "Richness",
  saltiness: "Saltiness",
  heat: "Heat",
  portionSize: "Portion size",
  doneness: "Doneness",
};

/**
 * The five points, in her words, per axis.
 *
 * Written out per axis rather than generated from "too much / too little",
 * because the natural English differs: bread is UNDERDONE, not "not done
 * enough", and a portion is SMALL, not "not big enough". A scale whose labels
 * read like machine output gets answered carelessly.
 */
export const AXIS_SCALE: Record<SensoryAxis, [string, string, string, string, string]> = {
  sweetness: ["Not sweet at all", "Could be sweeter", "Just right", "A bit sweet", "Far too sweet"],
  moisture: ["Very dry", "A bit dry", "Just right", "A bit wet", "Far too wet"],
  richness: ["Very plain", "A bit plain", "Just right", "A bit rich", "Far too rich"],
  saltiness: ["Not salty at all", "Could use salt", "Just right", "A bit salty", "Far too salty"],
  heat: ["No heat at all", "Could be hotter", "Just right", "A bit hot", "Far too hot"],
  portionSize: ["Far too small", "A bit small", "Just right", "A bit big", "Far too big"],
  doneness: ["Very underdone", "A bit underdone", "Just right", "A bit overdone", "Very overdone"],
};

/** How the readout names a direction: [not enough, too much]. */
const AXIS_DIRECTION: Record<SensoryAxis, [string, string]> = {
  sweetness: ["not sweet enough", "too sweet"],
  moisture: ["too dry", "too wet"],
  richness: ["too plain", "too rich"],
  saltiness: ["under-salted", "too salty"],
  heat: ["not hot enough", "too hot"],
  portionSize: ["too small", "too big"],
  doneness: ["underdone", "overdone"],
};

/** The five values, low to high. Index into `counts` is `value + 2`. */
export const SCALE_VALUES = [-2, -1, 0, 1, 2] as const;

/**
 * −2..+2 → the radar's hard-coded 0..100 domain.
 *
 * NOT a convenience. `radar-chart.tsx:108` builds `scaleLinear({ domain: [0,
 * 100] })` with no prop and no auto-scaling, and a negative value maps to a
 * negative radius — which visx renders MIRRORED THROUGH THE CENTRE rather than
 * clamping. An unmapped −1 would draw on the opposite side of the chart and
 * look like data.
 */
export const toRadarValue = (v: number) => (v + 2) * 25;

export interface AxisSummary {
  axis: SensoryAxis;
  label: string;
  /** Counts at −2,−1,0,+1,+2 in that order. The proportion bar reads this,
   * and it is the only representation that cannot collapse. */
  counts: [number, number, number, number, number];
  n: number;
  /** Of `n`, how many are her own logged notes rather than the form. */
  chefN: number;
  /** For the radar polygon, on the 0..100 scale. It DOES collapse — which is
   * exactly why nothing renders it without `counts` beside it. */
  meanRadarValue: number;
  /** Ratings on BOTH sides of the midpoint. Some said too sweet and some said
   * not sweet enough: that is an inconsistency between batches, and the fix is
   * nothing like the fix for everyone agreeing it is too sweet. */
  splitBothWays: boolean;
  /** Her words. Names both directions whenever both exist. */
  sentence: string;
}

export interface FeedbackRow {
  source: "chef" | "customer";
  axisRatings: { axis: string; value: number }[];
  flags: string[];
  /** "She said the icing was lovely but it arrived warm." Carried because a
   * note with no rating and no flag is still somebody having spoken, and
   * leaving it out of the denominator would undercount her own logging —
   * which is exactly the shape her logging takes most often. */
  freeText?: string;
}

export interface Summary {
  axes: AxisSummary[];
  /** Rows that carried at least one rating or flag for this item. */
  n: number;
  chefN: number;
  flagCounts: Record<FeedbackFlag, number>;
  /** "9 of the 11 are your notes." Null when there is nothing to qualify. */
  provenance: string | null;
}

const FLAGS: FeedbackFlag[] = ["tooExpensive", "late", "packaging", "lovedIt"];

export const FLAG_LABEL: Record<FeedbackFlag, string> = {
  tooExpensive: "Too expensive",
  late: "Late",
  packaging: "Packaging",
  lovedIt: "Loved it",
};

function isAxis(value: string): value is SensoryAxis {
  return (SENSORY_AXES as string[]).includes(value);
}

/**
 * Aggregate the rows for one menu item against the axes IT declares.
 *
 * Ratings for axes the item no longer carries are dropped rather than shown:
 * she removed the axis, which is a decision, and resurrecting old ratings for
 * it would contradict her. Rows are never deleted — the history stays.
 */
export function summarise(axes: SensoryAxis[], rows: FeedbackRow[]): Summary {
  const flagCounts = Object.fromEntries(FLAGS.map((f) => [f, 0])) as Record<
    FeedbackFlag,
    number
  >;
  for (const row of rows) {
    for (const flag of row.flags) {
      if (flag in flagCounts) flagCounts[flag as FeedbackFlag] += 1;
    }
  }

  const summaries: AxisSummary[] = axes.filter(isAxis).map((axis) => {
    const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    let n = 0;
    let chefN = 0;
    let total = 0;
    for (const row of rows) {
      for (const rating of row.axisRatings) {
        if (rating.axis !== axis) continue;
        const index = Math.round(rating.value) + 2;
        if (index < 0 || index > 4) continue;
        counts[index] += 1;
        n += 1;
        total += Math.round(rating.value);
        if (row.source === "chef") chefN += 1;
      }
    }
    const under = counts[0] + counts[1];
    const over = counts[3] + counts[4];
    return {
      axis,
      label: AXIS_LABEL[axis],
      counts,
      n,
      chefN,
      // 50 — "just right" — when nothing has been said, so an unrated axis
      // sits on the midline rather than collapsing the polygon to the centre
      // and drawing a claim nobody made.
      meanRadarValue: n === 0 ? 50 : toRadarValue(total / n),
      splitBothWays: under > 0 && over > 0,
      sentence: axisSentence(axis, counts, n),
    };
  });

  // A row counts once toward n if it said ANYTHING about this item — a rating
  // on one of its axes, a flag, or words. A row that rated only an axis she has
  // since removed contributed nothing and is not counted; an empty row was
  // never feedback at all.
  const relevant = rows.filter(
    (row) =>
      row.flags.length > 0 ||
      Boolean(row.freeText?.trim()) ||
      row.axisRatings.some((r) => isAxis(r.axis) && axes.includes(r.axis)),
  );
  const n = relevant.length;
  const chefN = relevant.filter((r) => r.source === "chef").length;

  return { axes: summaries, n, chefN, flagCounts, provenance: provenanceOf(n, chefN) };
}

/**
 * "7 of 11 said too sweet. 2 said not sweet enough."
 *
 * Both directions whenever both exist, and never a single magnitude. The
 * silence when nobody said anything is deliberate: "0 of 0 said too sweet" is
 * a number Sous cannot stand behind.
 */
function axisSentence(
  axis: SensoryAxis,
  counts: [number, number, number, number, number],
  n: number,
): string {
  if (n === 0) return "Nobody has said yet.";
  const [low, high] = AXIS_DIRECTION[axis];
  const under = counts[0] + counts[1];
  const over = counts[3] + counts[4];
  const justRight = counts[2];

  if (under === 0 && over === 0) {
    return `All ${n} said just right.`;
  }
  const parts: string[] = [];
  if (over > 0) parts.push(`${over} of ${n} said ${high}`);
  if (under > 0) {
    // The denominator appears once. Repeating "of 11" twice in one sentence
    // reads like two different samples.
    parts.push(parts.length > 0 ? `${under} said ${low}` : `${under} of ${n} said ${low}`);
  }
  if (justRight > 0) parts.push(`${justRight} said just right`);
  return `${parts.join(". ")}.`;
}

/**
 * "9 of the 11 are your notes."
 *
 * Stated whenever her own logging is any part of the count — not only when it
 * is the majority. She should never have to wonder which half she is looking
 * at (rule 2).
 */
function provenanceOf(n: number, chefN: number): string | null {
  if (n === 0 || chefN === 0) return null;
  if (chefN === n) {
    return n === 1
      ? "That one is your own note."
      : `All ${n} are your own notes — nobody has used the form yet.`;
  }
  return `${chefN} of the ${n} are your notes; ${n - chefN} came from the form.`;
}

// --- The optimiser's warnings ----------------------------------------------

/**
 * Fill the hole `convex/lib/optimiser.ts` has been carrying since it was
 * written: a `FeedbackWarning[]` that has always been empty.
 *
 * Feedback constrains the optimiser as a WARNING, never a veto (CONTEXT.md) —
 * so nothing here feeds the arithmetic. It renders beside it.
 *
 * Both warnings state provenance, and this is the single most load-bearing
 * sentence in the file. The optimiser's yield lever can shrink a product until
 * it is not worth buying; the thing standing in its way is customers saying it
 * is already too small. If all four of those "customers" are in fact her own
 * recollections, then her own belief is being fed back to her as evidence, and
 * she is entitled to know that before she acts on it.
 */
export function warningsFor(summary: Summary): FeedbackWarning[] {
  const out: FeedbackWarning[] = [];

  const expensive = summary.flagCounts.tooExpensive;
  if (expensive > 0) {
    out.push({
      kind: "tooExpensive",
      detail: `${expensive} of the last ${summary.n} said it was too expensive${chefTail(summary, expensive)}`,
      sampleSize: summary.n,
    });
  }

  const portion = summary.axes.find((a) => a.axis === "portionSize");
  if (portion && portion.n > 0) {
    const tooSmall = portion.counts[0] + portion.counts[1];
    if (tooSmall > 0) {
      out.push({
        kind: "portionTooSmall",
        detail: `${tooSmall} of the last ${portion.n} said it was too small${chefTail(summary, tooSmall)}`,
        sampleSize: portion.n,
      });
    }
  }

  return out;
}

/** " — three of those four are your notes." Only when it applies. */
function chefTail(summary: Summary, count: number): string {
  if (summary.chefN === 0) return ".";
  // The overlap between "said this" and "is a chef note" is not knowable from
  // the aggregate, so this states the SHAPE of the sample rather than claiming
  // a figure it cannot support.
  if (summary.chefN === summary.n) {
    return count === 1
      ? " — and that one is your own note."
      : " — all of them from your own notes.";
  }
  return ` — ${summary.chefN} of your ${summary.n} entries are your own notes.`;
}
