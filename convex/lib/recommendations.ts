import { money, type LeakCause, type LeakKind } from "./pnl";

/**
 * Every suggestion Sous has, in one ranking.
 *
 * Pure and free of Convex, for the same reason convex/lib/pnl.ts is: this is
 * where a silent lie would live. A recommendation is an instruction to spend
 * her afternoon on something, so a figure that is quietly wrong costs her the
 * afternoon.
 *
 * Four rules shape the file, all of them settled before it was written.
 *
 * 1. **ONE ENGINE, TAGGED BY HORIZON.** Period causes come from
 *    `pnl.periodCauses` — the identical atoms Home's leak sentences are
 *    grouped from. Home groups them by KIND; this groups them by SUBJECT.
 *    Neither recomputes anything, so the two screens cannot quote different
 *    money for the same month. `horizon` says whether a row is bounded by the
 *    period switcher or carries its own window.
 * 2. **ONE CARD PER SUBJECT.** An item that is wasting, underpriced and stale
 *    is ONE row with one figure and three pieces of evidence, not three rows.
 *    No dollar is counted twice, which is what makes the bar chart sum to the
 *    list beneath it.
 * 3. **ONE NUMBER, AND EACH CARD NAMES ITS KIND.** Everything ranks on a
 *    single cents figure. Because those cents are not all the same KIND of
 *    money — never paid for, never earned, stopped coming in — each card says
 *    which it is. Ranking without saying would compare a real loss with a
 *    hypothetical gain and call them equal.
 * 4. **NOTHING IS INVENTED TO MAKE IT RANK.** A condition with no honest
 *    dollar figure — a stale price, a wasteful batch size — never gets one
 *    assigned so it can join the ranking. It rides along as evidence on a row
 *    that already has money, or it sits outside the ranking entirely.
 * 5. **A SUBJECT IS SOMETHING SHE CAN CHANGE.** A delivered order is history;
 *    no button reprices it. So order-scoped causes collapse into one row per
 *    kind, pointed at the thing that CAN move — the prices behind the orders,
 *    or the delivery fee. The money is untouched, which is what keeps this
 *    screen and Home in agreement; only the row it sits on changes. Without
 *    this the browser showed nine cards reading "this order came in $1.15
 *    under target", burying the six rows worth an afternoon.
 */

/** Structural kinds sit alongside pnl's period kinds in one union. */
export type StructuralKind =
  | "underpriced"
  | "dormant"
  | "batchSize"
  | "stalePrice";

export type CauseKind = LeakKind | StructuralKind;

const STRUCTURAL: ReadonlySet<CauseKind> = new Set<CauseKind>([
  "underpriced",
  "dormant",
  "batchSize",
  "stalePrice",
]);

/**
 * What kind of dollar this is. Rule 3: a card that says "$41" without saying
 * which of these it means is inviting her to add it to a number it cannot be
 * added to.
 */
const KIND_LABEL: Record<CauseKind, string> = {
  waste: "never paid for",
  belowTarget: "below what you aimed at",
  drift: "costing more than your recipe says",
  delivery: "spent getting it there",
  discounts: "given away",
  underpriced: "below what you aimed at",
  dormant: "stopped coming in",
  batchSize: "structurally wasteful",
  stalePrice: "priced a long time ago",
};

/** Fixed order for ties, so the same data always ranks the same way. */
const KIND_ORDER: CauseKind[] = [
  "waste",
  "underpriced",
  "belowTarget",
  "drift",
  "delivery",
  "discounts",
  "dormant",
  "batchSize",
  "stalePrice",
];

export interface Cause {
  kind: CauseKind;
  /** Zero when this condition adds no money of its own (rule 4). */
  cents: number;
  /** Her words. Flags, never instructs (CONTEXT.md). */
  sentence: string;
  /** The arithmetic behind it, shown on tap. Never a restatement. */
  workings: string;
}

export type ActionKind = "adoptMedian" | "optimise" | "batchSize" | "navigate";

export interface RecommendationAction {
  kind: ActionKind;
  label: string;
  href: string;
  /** The document the mutation acts on, for the in-place actions. */
  targetId: string | null;
}

export interface TrendPoint extends Record<string, number | string> {
  /** Domain day. The vendored cartesian X is a hard-coded scaleTime. */
  date: string;
  value: number;
}

export interface Trend {
  label: string;
  points: TrendPoint[];
}

/** DESIGN.md §5. A line through three points is a shape, not a trend. */
export const MIN_TREND_POINTS = 8;

export interface Recommendation {
  subjectKey: string;
  subjectName: string;
  /** "period" when ANY cause is bounded by the period switcher. Structural
   * rows ignore the switcher and state their own window instead. */
  horizon: "period" | "structural";
  /** The ranking is by this, and only this. */
  cents: number;
  /** What Home may claim: period causes only, so its headline never includes
   * money that is not in the period P&L. */
  periodCents: number;
  kindLabel: string;
  /** The top cause's sentence — what the card leads with. */
  headline: string;
  /** Biggest first. Zero-money evidence sorts last. */
  causes: Cause[];
  action: RecommendationAction;
  /** Structural rows only: "no orders in 60 days". */
  window: string | null;
  /** Only where trend IS the argument, and only with enough points. */
  trend: Trend | null;
}

// --- Structural facts ------------------------------------------------------

/**
 * What the database found, before any sentence is written about it.
 *
 * Facts in, prose out: every string a card shows is built here, which is what
 * makes the wording testable rather than scattered through a query that needs
 * a database to run.
 */
export interface StructuralFacts {
  menuItemId: string;
  name: string;
  /** Below its own target gross margin, with what would close the gap. */
  underpriced?: {
    priceNowCents: number;
    priceToReachTargetCents: number;
    targetPercent: number;
    grossMarginNowPercent: number | null;
    /** Sold in the window. The gap is per unit; this turns it into money. */
    unitsMilli: number;
    /** The optimiser's own words when a fence, not the price, is the answer. */
    verdictHeadline: string | null;
  };
  /** No orders in the recent window, but orders before it. */
  dormant?: {
    lastOrderedDay: string;
    /** OBSERVED days since the last order — what the card states. Always at
     * least windowDays, usually more. */
    quietDays: number;
    /** The two equal windows the figure compares: earned in the one before,
     * nothing in the one since. Carried so the sentence can say "60 days"
     * without this module deciding what 60 is. */
    windowDays: number;
    /** OBSERVED, never projected: what it earned in the window BEFORE it went
     * quiet. A forecast of what it "would have" earned is a number Sous
     * cannot stand behind. */
    priorRevenueCents: number;
  };
  /** A base batch structurally larger than a typical order. */
  batch?: {
    baseBatchYield: number;
    typicalOrderUnits: number;
  };
  /** Priced longer ago than the threshold. Absent when priceSetAt is unset —
   * an item that predates the field is silent, not stale. */
  stalePrice?: {
    priceSetDay: string;
    days: number;
  };
}

export interface Dismissal {
  subjectKey: string;
  dismissedAt: number;
  dismissedAtCents: number;
  causeKinds: string[];
}

export interface RecommendationInput {
  /** "/slug", for hrefs. */
  base: string;
  /** The period causes, from pnl.periodCauses. Rule 1. */
  period: LeakCause[];
  structural: StructuralFacts[];
  /** Keyed by subjectKey. Only drift and dormant have one (rule: a card whose
   * argument is a single number carries no chart). */
  trends: Record<string, Trend>;
  dismissals: Dismissal[];
}

export interface RecommendationResult {
  /** Ranked by dollar impact, never by recency or type. */
  live: Recommendation[];
  /** Set aside and still quiet. Kept so she can pick one back up. */
  dismissed: Recommendation[];
  /**
   * Items priced long ago with nothing else wrong. Deliberately OUTSIDE the
   * ranking and off the chart: staleness has no honest dollar figure of its
   * own, and inventing one so it could be ranked would break "ranked by dollar
   * impact" far worse than leaving it out does (rule 4).
   */
  stale: { menuItemId: string; name: string; days: number; href: string }[];
}

// --- Orders collapse -------------------------------------------------------

/** How many of the worst are named in the arithmetic. Enough to recognise the
 * pattern, few enough that the disclosure stays readable on a phone. */
const NAMED_ORDERS = 3;

const ORDER_SUBJECT: Partial<Record<LeakKind, { key: string; name: string }>> = {
  belowTarget: { key: "orders:belowTarget", name: "Orders under target" },
  delivery: { key: "orders:delivery", name: "Delivery" },
};

/**
 * Rule 5: fold every order-scoped cause into one row per kind.
 *
 * A delivered order is a fact, not a lever. Nine separate cards saying "this
 * order came in $1.15 under target" give her nine things to read and nothing
 * to do — the thing that can actually move is the price or the cost behind
 * them, and that is what the collapsed row points at.
 *
 * The cents are summed, never dropped, which is why the total this screen
 * ranks stays identical to the total Home claims.
 */
function collapseOrders(causes: LeakCause[]): LeakCause[] {
  const out: LeakCause[] = [];
  const grouped = new Map<string, LeakCause[]>();

  for (const cause of causes) {
    const subject = cause.subjectKey.startsWith("order:")
      ? ORDER_SUBJECT[cause.kind]
      : undefined;
    if (!subject) {
      out.push(cause);
      continue;
    }
    const bucket = grouped.get(subject.key);
    if (bucket) bucket.push(cause);
    else grouped.set(subject.key, [cause]);
  }

  for (const [key, group] of grouped) {
    const subject = ORDER_SUBJECT[group[0].kind]!;
    const cents = group.reduce((a, c) => a + c.cents, 0);
    const worst = [...group].sort((a, b) => b.cents - a.cents);
    const named = worst
      .slice(0, NAMED_ORDERS)
      .map((c) => `${c.subjectName} (${money(c.cents)})`)
      .join(", ");
    const rest = worst.length - Math.min(NAMED_ORDERS, worst.length);
    out.push({
      kind: group[0].kind,
      subjectKey: key,
      subjectName: subject.name,
      cents,
      workings:
        `Worst first: ${named}${rest > 0 ? `, and ${rest} more` : ""}. ` +
        (group[0].kind === "delivery"
          ? "What moves this is the delivery fee, not any one of these trips."
          : "An order that has shipped cannot be repriced — what moves this is the price or the cost behind it."),
    });
  }

  return out;
}

// --- Facts to causes -------------------------------------------------------

function structuralCauses(f: StructuralFacts): Cause[] {
  const causes: Cause[] = [];

  if (f.underpriced) {
    const u = f.underpriced;
    const gapPerUnit = u.priceToReachTargetCents - u.priceNowCents;
    const units = u.unitsMilli / 1000;
    // Never negative: a price already at or above target is not a gap.
    const cents = Math.max(0, Math.round(gapPerUnit * units));
    causes.push({
      kind: "underpriced",
      cents,
      sentence:
        u.grossMarginNowPercent != null
          ? `${f.name} earns ${u.grossMarginNowPercent}% against the ${u.targetPercent}% you set for it.`
          : `${f.name} is priced below the ${u.targetPercent}% you set for it.`,
      workings: u.verdictHeadline
        ? // The optimiser found a fence rather than a price. Say which.
          `${u.verdictHeadline} At ${money(u.priceNowCents)} across ${unitWord(units)} this period.`
        : `${money(u.priceToReachTargetCents)} instead of ${money(u.priceNowCents)} would reach ${u.targetPercent}% — ${money(gapPerUnit)} a unit across ${unitWord(units)} sold this period.`,
    });
  }

  if (f.dormant) {
    const d = f.dormant;
    causes.push({
      kind: "dormant",
      cents: Math.max(0, d.priorRevenueCents),
      sentence: `${f.name} has not been ordered since ${d.lastOrderedDay}.`,
      workings: `${money(d.priorRevenueCents)} in the ${d.windowDays} days before that, and nothing in the ${d.windowDays} days since. That figure is what it earned, not what it would have earned.`,
    });
  }

  if (f.batch) {
    const b = f.batch;
    causes.push({
      // Rule 4: no money of its own. It is the OBSERVATION behind waste, not a
      // second helping of it — the waste cause already counts those dollars.
      kind: "batchSize",
      cents: 0,
      sentence: `A batch makes ${b.baseBatchYield}; a typical order is ${b.typicalOrderUnits}.`,
      workings: `${b.baseBatchYield - b.typicalOrderUnits} over on a typical order, before any recipe arithmetic. Baking to order or cutting the base batch removes the overhang at the source.`,
    });
  }

  if (f.stalePrice) {
    causes.push({
      kind: "stalePrice",
      cents: 0,
      sentence: `Priced on ${f.stalePrice.priceSetDay} and not since.`,
      workings: `${f.stalePrice.days} days at the same price. Sous is not saying it is the wrong price — only that nothing has checked it against what things cost now.`,
    });
  }

  return causes;
}

function unitWord(units: number): string {
  const n = Number.isInteger(units) ? units : Math.round(units * 10) / 10;
  return `${n} ${n === 1 ? "unit" : "units"}`;
}

// --- Actions ---------------------------------------------------------------

/**
 * One card, one action. Chosen from the LARGEST cause, because that is the
 * money the row is ranked on and therefore the thing she came to fix.
 */
function actionFor(cause: Cause, subjectKey: string, base: string): RecommendationAction {
  const [type, id] = splitKey(subjectKey);
  switch (cause.kind) {
    case "drift":
      return {
        kind: "adoptMedian",
        label: "Re-cost it",
        href: `${base}/pantry/${id}`,
        targetId: id,
      };
    case "underpriced":
      return {
        kind: "optimise",
        label: "Open the optimiser",
        href: `${base}/menu/${id}?optimise=1`,
        targetId: id,
      };
    case "waste":
    case "batchSize":
      return {
        kind: "batchSize",
        label: "Change the batch size",
        href: `${base}/menu/${id}?focus=batch`,
        targetId: id,
      };
    case "belowTarget":
      // Not "open the order" — the orders have shipped. The ranking that
      // shows which prices are doing this is the thing worth opening.
      return {
        kind: "navigate",
        label: "See which orders",
        href: `${base}/insights/orders`,
        targetId: null,
      };
    case "delivery":
      return {
        kind: "navigate",
        label: "Change the delivery fee",
        href: `${base}/settings`,
        targetId: null,
      };
    case "dormant":
    case "stalePrice":
      return {
        kind: "navigate",
        label: "Open the item",
        href: `${base}/menu/${id}`,
        targetId: id,
      };
    case "discounts":
      return {
        kind: "navigate",
        label: "See the orders",
        href: `${base}/insights/orders`,
        targetId: null,
      };
  }
  // Unreachable; `type` keeps the destructure honest for a future kind.
  return { kind: "navigate", label: "Open", href: base, targetId: type ? id : null };
}

function splitKey(subjectKey: string): [string, string] {
  const at = subjectKey.indexOf(":");
  return at === -1 ? [subjectKey, ""] : [subjectKey.slice(0, at), subjectKey.slice(at + 1)];
}

// --- Dismissal -------------------------------------------------------------

/**
 * How far the money must move before a dismissed card comes back.
 *
 * A threshold rather than "any change" because every figure here moves a
 * little every day — without one, "not now" would mean "until tomorrow". A
 * quarter is wide enough to stay quiet through ordinary drift and narrow
 * enough that a problem doubling is never silent.
 */
export const RESURFACE_FRACTION = 0.25;

export function shouldResurface(
  dismissal: Dismissal,
  cents: number,
  kinds: CauseKind[],
): boolean {
  // A new cause brings it back even when the money has not moved: she
  // dismissed the problem she was SHOWN, not every problem this subject will
  // ever have.
  const known = new Set(dismissal.causeKinds);
  if (kinds.some((k) => !known.has(k))) return true;
  // Guard the divide, and treat any money appearing where there was none as a
  // material move rather than as a division by zero.
  const base = Math.abs(dismissal.dismissedAtCents);
  if (base === 0) return cents > 0;
  return Math.abs(cents - dismissal.dismissedAtCents) / base > RESURFACE_FRACTION;
}

// --- The ranking -----------------------------------------------------------

export function rankRecommendations(
  input: RecommendationInput,
): RecommendationResult {
  const bySubject = new Map<
    string,
    { name: string; causes: Cause[] }
  >();

  const add = (subjectKey: string, name: string, cause: Cause) => {
    const entry = bySubject.get(subjectKey) ?? { name, causes: [] };
    entry.causes.push(cause);
    bySubject.set(subjectKey, entry);
  };

  for (const c of collapseOrders(input.period)) {
    add(c.subjectKey, c.subjectName, {
      kind: c.kind,
      cents: c.cents,
      sentence: periodSentence(c),
      workings: c.workings,
    });
  }
  for (const facts of input.structural) {
    const key = `item:${facts.menuItemId}`;
    for (const cause of structuralCauses(facts)) add(key, facts.name, cause);
  }

  const live: Recommendation[] = [];
  const dismissed: Recommendation[] = [];
  const stale: RecommendationResult["stale"] = [];
  const dismissalBy = new Map(input.dismissals.map((d) => [d.subjectKey, d]));

  for (const [subjectKey, entry] of bySubject) {
    const cents = entry.causes.reduce((a, c) => a + c.cents, 0);

    if (cents === 0) {
      // Rule 4. No honest figure means no place in a ranking BY figures.
      // A stale price is still worth a mention, so it goes to the tail; a
      // lone batch-size observation is not, because the thing that would make
      // it matter — waste — is not happening.
      const staleCause = entry.causes.find((c) => c.kind === "stalePrice");
      if (staleCause) {
        const [, id] = splitKey(subjectKey);
        const facts = input.structural.find((f) => f.menuItemId === id);
        if (facts?.stalePrice) {
          stale.push({
            menuItemId: id,
            name: entry.name,
            days: facts.stalePrice.days,
            href: `${input.base}/menu/${id}`,
          });
        }
      }
      continue;
    }

    // Biggest first, so the card leads with the money it is ranked on and the
    // zero-dollar evidence reads as evidence.
    const causes = [...entry.causes].sort(
      (a, b) =>
        b.cents - a.cents ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
    const top = causes[0];
    const kinds = causes.map((c) => c.kind);
    const periodCents = causes
      .filter((c) => !STRUCTURAL.has(c.kind))
      .reduce((a, c) => a + c.cents, 0);
    const trend = input.trends[subjectKey];

    const row: Recommendation = {
      subjectKey,
      subjectName: entry.name,
      horizon: kinds.some((k) => !STRUCTURAL.has(k)) ? "period" : "structural",
      cents,
      periodCents,
      kindLabel: KIND_LABEL[top.kind],
      headline: top.sentence,
      causes,
      action: actionFor(top, subjectKey, input.base),
      window: windowFor(causes, input.structural, subjectKey),
      // Suppressed below the floor rather than drawn through: a two-point
      // line looks like a finding and is not one.
      trend: trend && trend.points.length >= MIN_TREND_POINTS ? trend : null,
    };

    const dismissal = dismissalBy.get(subjectKey);
    if (dismissal && !shouldResurface(dismissal, cents, kinds)) {
      dismissed.push(row);
    } else {
      live.push(row);
    }
  }

  const rank = (a: Recommendation, b: Recommendation) =>
    b.cents - a.cents || a.subjectKey.localeCompare(b.subjectKey);

  return {
    live: live.sort(rank),
    dismissed: dismissed.sort(rank),
    stale: stale.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name)),
  };
}

/**
 * The per-subject sentence for a period cause.
 *
 * Home's sentences are AGGREGATES over a kind — "$96 of what you baked was
 * never paid for". Here the same money is attributed to one subject, so it
 * needs its own wording. The figures are identical either way; only the
 * grouping differs (rule 1).
 */
function periodSentence(c: LeakCause): string {
  switch (c.kind) {
    case "waste":
      return `${money(c.cents)} of ${c.subjectName} was baked and never sold.`;
    case "belowTarget":
      return `Orders came in ${money(c.cents)} short of your target margin between them.`;
    case "drift":
      return `${c.subjectName} now costs ${money(c.cents)} more than your recipes say.`;
    case "delivery":
      return `Deliveries cost ${money(c.cents)} more in fuel than you charged for them.`;
    case "discounts":
      return `${money(c.cents)} came off in discounts.`;
  }
}

/**
 * The window a structural card states for itself.
 *
 * Decided during grilling: the period switcher drives period rows, so Home and
 * this screen quote the same figures when both are on the same period. A
 * structural row ignores it, and therefore has to say so in words — otherwise
 * she switches to "this week" and reasonably assumes every number moved.
 */
function windowFor(
  causes: Cause[],
  structural: StructuralFacts[],
  subjectKey: string,
): string | null {
  if (causes.some((c) => !STRUCTURAL.has(c.kind))) return null;
  const [, id] = splitKey(subjectKey);
  const facts = structural.find((f) => f.menuItemId === id);
  const top = causes[0];
  if (top.kind === "dormant" && facts?.dormant) {
    return `No orders in ${facts.dormant.quietDays} days`;
  }
  if (top.kind === "underpriced") return "At this period's volume";
  if (top.kind === "stalePrice" && facts?.stalePrice) {
    return `Priced ${facts.stalePrice.days} days ago`;
  }
  return null;
}
