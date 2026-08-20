/**
 * The optimiser. Pure — no Convex imports — for the same three reasons the
 * cost engine is: the builder runs it live against unsaved form state, the
 * server can run it, and it unit-tests directly.
 *
 * It answers one question: what combinations of price and yield reach her
 * target gross margin, and if none do, why not. It states arithmetic and
 * nothing else. It never says "raise your price"; it says "65% would need
 * $2.74". Sous knows nothing about demand, so an instruction would be a claim
 * it cannot support (CONTEXT.md).
 *
 * The shape of the problem, which is the whole feature:
 *
 *   variable(N) = L1/N + L2      gross is against this
 *   total(N)    = (L1+L3)/N + L2 net is against this
 *
 * Layer 2 — packaging, box, ribbon — is per unit and does NOT scale with
 * yield. A box costs 42c whether the tray is cut into 10 or 40. So as N grows,
 * variable cost falls toward L2 but never past it, and gross margin is
 * asymptotically capped at (P − L2)/P. That ceiling is precisely why cutting
 * finer often cannot reach a target, and saying so outright is worth more than
 * any suggestion this module could make.
 */

import { rescaleUnitWeight, type Costing } from "./costing";

/** How far below her current yield the ladder starts, so she can see the
 * shape she is standing on rather than only the road ahead. */
const WINDOW_LOOKBACK = 3;
const MAX_BARS = 12;
/** A backstop on the walk in step 4. A yield past this is not a kitchen. */
const MAX_YIELD_SEARCH = 10_000;
/** A millionth of a cent. Levers are fractional (flour at 500 g × $1.85/kg is
 * 92.5c), so every comparison is epsilon-guarded rather than exact. */
const CENT_EPSILON = 1e-6;
const PERCENT_EPSILON = 1e-9;

/** Her five fences. constraintNote is required by the mutation the moment any
 * one of them is set — a limit without a reason rots. */
export interface OptimiserConstraints {
  minPriceCents: number | null;
  maxPriceCents: number | null;
  minYield: number | null;
  maxYield: number | null;
  unitWeightFloorMilligrams: number | null;
  constraintNote: string | null;
}

/**
 * Reserved for 5.2. Feedback constrains the optimiser as a warning, never a
 * veto (CONTEXT.md) — so it arrives as something to render beside the
 * arithmetic, never as an input to the arithmetic. Typed now, always empty
 * here, so wiring it later changes no signature.
 */
export interface FeedbackWarning {
  kind: "tooExpensive" | "portionTooSmall";
  /** "Four of the last nine said it was too small." Her evidence, counted. */
  detail: string;
  sampleSize: number;
}

export interface OptimiserInput {
  /** Costed at her CURRENT yield. The optimiser re-parameterises from it. */
  costing: Costing;
  constraints: OptimiserConstraints;
  /** Live form state, for the builder. Falls back to the costing's own. */
  priceCents?: number | null;
  targetGrossMarginPercent?: number | null;
  feedbackWarnings?: FeedbackWarning[];
}

/**
 * The three layers freed from any particular yield. Exported because this is
 * the whole of the maths and deserves testing on its own.
 */
export interface CostLevers {
  layer1CentsPerBatch: number;
  layer2CentsPerUnit: number;
  layer3CentsPerBatch: number;
  currentYield: number;
  currentUnitWeightMilligrams: number;
}

export type BlockKind =
  | "unitWeightFloor"
  | "maxYield"
  | "maxPrice"
  | "minYield"
  | "minPrice";

export interface YieldBlock {
  kind: BlockKind;
  /**
   * "blocking" strikes the row; "advisory" annotates it. A price FLOOR can
   * never stop her reaching a margin target — charging above it only
   * overshoots — so minPrice is advisory always. Striking it would mark her
   * best options unusable, which is false.
   */
  severity: "blocking" | "advisory";
  /** "38 g is under your 40 g floor." Her numbers, not the fence's name. */
  reason: string;
  /** Her own words for why the fence exists. Never shown without them. */
  note: string | null;
}

export interface YieldOption {
  yieldUnits: number;
  isCurrent: boolean;
  unitWeightMilligrams: number;
  ingredientsCentsPerUnit: number;
  extrasCentsPerUnit: number;
  overheadCentsPerUnit: number;
  variableCentsPerUnit: number;
  totalCentsPerUnit: number;
  /** Rounded for display, by the same expression the cost card uses, so the
   * two can never disagree by a point. */
  grossMarginPercent: number | null;
  netMarginPercent: number | null;
  /** Unrounded. The UI shows a decimal wherever rounded and exact disagree —
   * at yield 19 the bar reads 65% and does NOT reach 65%, and without this
   * that looks like a bug rather than rounding. */
  grossMarginExact: number | null;
  netMarginExact: number | null;
  /** Exact comparison. Never derived from the rounded percent. */
  reachesTarget: boolean;
  /** What she would charge at this yield to reach target. */
  priceToReachTargetCents: number | null;
  blocks: YieldBlock[];
  /** Any block of severity "blocking". */
  blocked: boolean;
}

export type VerdictKind =
  | "noCost"
  | "noPrice"
  | "noTarget"
  | "impossibleTarget"
  | "asymptote"
  | "alreadyAtTarget"
  | "reachable"
  | "blocked";

export interface Verdict {
  kind: VerdictKind;
  headline: string;
  detail: string;
  /** (P − L2)/P × 100 — the most gross can ever be at this price. */
  ceilingPercentExact: number | null;
  ceilingPercent: number | null;
  layer2CentsPerUnit: number;
  /** Smallest yield reaching target, every fence ignored. */
  targetYield: number | null;
  targetYieldInWindow: boolean;
  /** Net margin at that yield. Gross can clear target while net is still
   * negative, and neither margin substitutes for the other (CONTEXT.md). */
  targetYieldNetMarginPercent: number | null;
  /** Among fences blocking targetYield, the one met first walking up. */
  bindingConstraint: BlockKind | null;
  bindingConstraintOnsetYield: number | null;
  /** Drop that one fence — does target clear? The anti-whack-a-mole answer. */
  relaxingBindingAloneReachesTarget: boolean;
  constraintNote: string | null;
}

export interface Optimisation {
  currentYield: number;
  priceCents: number | null;
  targetGrossMarginPercent: number | null;
  /** Read verbatim off the current row, so the headline number and the
   * tooltip on today's bar can never disagree. */
  priceToReachTargetAtCurrentYieldCents: number | null;
  priceToReachTargetAtCurrentYieldBlocks: YieldBlock[];
  options: YieldOption[];
  windowStartYield: number;
  windowEndYield: number;
  ceilingPercentExact: number | null;
  verdict: Verdict;
  /** minYield > maxYield. Surfaced, never silently reconciled. */
  contradictoryConstraints: boolean;
  feedbackWarnings: FeedbackWarning[];
}

// --- Levers ---------------------------------------------------------------

/**
 * Pull the three yield-independent levers off a costing.
 *
 * The trap: `costing.extras.centsPerBatch` is `centsPerUnit × yieldUnits`, so
 * it is yield-DEPENDENT. Reading it here would make packaging scale with
 * yield and destroy the asymptote — the one result this module exists to
 * report. Layer 2 is only ever read per unit.
 */
export function leversFrom(costing: Costing): CostLevers {
  const currentYield =
    Number.isFinite(costing.yieldUnits) && costing.yieldUnits >= 1
      ? Math.floor(costing.yieldUnits)
      : 1;
  return {
    layer1CentsPerBatch: finite(costing.ingredients.centsPerBatch),
    layer2CentsPerUnit: finite(costing.extras.centsPerUnit),
    layer3CentsPerBatch: finite(costing.overhead.centsPerBatch),
    currentYield,
    currentUnitWeightMilligrams: finite(costing.unitWeightMilligrams),
  };
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** Up to the next whole cent. Never down: a price rounded down misses the
 * target it was solved for. The epsilon is load-bearing in the other
 * direction — 70/0.35 is 200.00000000000003 in IEEE754, and a naive ceil
 * would tell her to charge $2.01 for an exactly-$2.00 answer. */
function ceilCents(n: number): number {
  return Math.ceil(n - CENT_EPSILON);
}

// --- The engine -----------------------------------------------------------

export function optimise(input: OptimiserInput): Optimisation {
  const levers = leversFrom(input.costing);
  const { layer1CentsPerBatch: l1, layer2CentsPerUnit: l2, layer3CentsPerBatch: l3 } = levers;
  const currentYield = levers.currentYield;
  const c = input.constraints;
  const feedbackWarnings = input.feedbackWarnings ?? [];

  const rawPrice =
    input.priceCents !== undefined ? input.priceCents : input.costing.priceCents;
  const price =
    rawPrice != null && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;

  const rawTarget =
    input.targetGrossMarginPercent !== undefined
      ? input.targetGrossMarginPercent
      : input.costing.targetGrossMarginPercent;
  const targetGiven = rawTarget != null && Number.isFinite(rawTarget);
  const impossibleTarget = targetGiven && (rawTarget! < 0 || rawTarget! >= 100);
  const target = targetGiven && !impossibleTarget ? rawTarget! : null;

  const hasCost = l1 > CENT_EPSILON || l2 > CENT_EPSILON || l3 > CENT_EPSILON;
  const contradictoryConstraints =
    c.minYield != null && c.maxYield != null && c.minYield > c.maxYield;

  // --- the per-yield functions ---
  const variableAt = (n: number) => l1 / n + l2;
  const totalAt = (n: number) => (l1 + l3) / n + l2;
  const weightAt = (n: number) =>
    rescaleUnitWeight(levers.currentUnitWeightMilligrams, currentYield, n);

  /** The only reach test in this module. Rearranged to avoid dividing by a
   * price that may be tiny, and epsilon-guarded so an exact hit counts. */
  const reaches = (n: number): boolean =>
    price != null &&
    target != null &&
    price * (100 - target) >= 100 * variableAt(n) - PERCENT_EPSILON;

  const priceToReachTargetAt = (n: number): number | null => {
    if (target == null) return null;
    const v = variableAt(n);
    // "Charge $0.00" is not arithmetic worth stating.
    if (v <= CENT_EPSILON) return null;
    return ceilCents((v * 100) / (100 - target));
  };

  // --- ceiling and headroom (tier 1) ---
  const ceilingPercentExact = price != null ? ((price - l2) / price) * 100 : null;
  const ceilingPercent =
    ceilingPercentExact != null ? Math.round(ceilingPercentExact) : null;
  // Cents of layer-1 budget per unit left after packaging and her target.
  const headroom = price != null && target != null ? price * (1 - target / 100) - l2 : null;
  // Equal to the ceiling is unreachable too: it needs L1/N = 0, i.e. N = ∞.
  const unreachable =
    headroom != null &&
    (headroom < -CENT_EPSILON || (Math.abs(headroom) <= CENT_EPSILON && l1 > CENT_EPSILON));

  // --- N*, fences ignored ---
  let targetYield: number | null = null;
  if (price != null && target != null && !unreachable && headroom != null) {
    if (l1 <= CENT_EPSILON) {
      // Variable cost is L2 at every yield; the ceiling alone decided this.
      targetYield = 1;
    } else {
      let n = Math.max(1, Math.ceil(l1 / headroom));
      // The closed form is right to within a step; the walk makes it exact
      // regardless of float. `reaches` is monotone in N, so this terminates.
      while (n < MAX_YIELD_SEARCH && !reaches(n)) n += 1;
      while (n > 1 && reaches(n - 1)) n -= 1;
      targetYield = reaches(n) ? n : null;
    }
  }

  // --- fences ---
  const activeAll: BlockKind[] = ["unitWeightFloor", "maxYield", "maxPrice", "minYield", "minPrice"];

  function blocksAt(n: number, active: BlockKind[]): YieldBlock[] {
    const out: YieldBlock[] = [];
    const note = c.constraintNote?.trim() || null;
    if (active.includes("minYield") && c.minYield != null && n < c.minYield) {
      out.push({
        kind: "minYield",
        severity: "blocking",
        reason: `${n} is fewer than the ${c.minYield} you set as your fewest.`,
        note,
      });
    }
    if (active.includes("maxYield") && c.maxYield != null && n > c.maxYield) {
      out.push({
        kind: "maxYield",
        severity: "blocking",
        reason: `${n} is more than the ${c.maxYield} you set as your most.`,
        note,
      });
    }
    if (active.includes("unitWeightFloor") && c.unitWeightFloorMilligrams != null) {
      // The ROUNDED weight, so a bar reading "40 g" never strikes against a
      // 40 g floor for a difference she cannot see.
      const w = weightAt(n);
      if (w < c.unitWeightFloorMilligrams) {
        out.push({
          kind: "unitWeightFloor",
          severity: "blocking",
          reason: `${grams(w)} is under the ${grams(c.unitWeightFloorMilligrams)} you set as your smallest.`,
          note,
        });
      }
    }
    const needed = priceToReachTargetAt(n);
    if (active.includes("maxPrice") && c.maxPriceCents != null && needed != null && needed > c.maxPriceCents) {
      out.push({
        kind: "maxPrice",
        severity: "blocking",
        reason: `${money(needed)} is above the ${money(c.maxPriceCents)} you set as your most.`,
        note,
      });
    }
    if (active.includes("minPrice") && c.minPriceCents != null && needed != null && needed < c.minPriceCents) {
      // Advisory, never blocking: charging her floor overshoots the target
      // rather than missing it.
      out.push({
        kind: "minPrice",
        severity: "advisory",
        reason: `${money(needed)} is under the ${money(c.minPriceCents)} you set as your least — at your floor you would clear target rather than miss it.`,
        note,
      });
    }
    return out;
  }

  const isBlocking = (blocks: YieldBlock[]) => blocks.some((b) => b.severity === "blocking");

  /** The smallest yield at which a given fence starts blocking, over all
   * N ≥ 1 — not over the window, which may start above the onset. */
  function onsetYield(kind: BlockKind): number | null {
    for (let n = 1; n <= MAX_YIELD_SEARCH; n += 1) {
      if (blocksAt(n, [kind]).some((b) => b.severity === "blocking")) return n;
    }
    return null;
  }

  // --- the window ---
  const windowStartYield = Math.max(1, currentYield - WINDOW_LOOKBACK);
  // Only UPWARD-closed fences truncate — the ones that start blocking as the
  // tray is cut finer and never stop. minYield blocks a downward region, and
  // maxPrice does too: the price needed FALLS as yield rises, so a ceiling
  // blocks the coarse end and releases the fine end. Capping the top of the
  // ladder at either would collapse it to nothing.
  let firstUpwardBlock: number | null = null;
  for (let n = windowStartYield; n < windowStartYield + MAX_BARS * 4; n += 1) {
    if (isBlocking(blocksAt(n, ["unitWeightFloor", "maxYield"]))) {
      firstUpwardBlock = n;
      break;
    }
  }
  let windowEndYield = windowStartYield + MAX_BARS - 1;
  if (targetYield != null) windowEndYield = Math.min(windowEndYield, Math.max(targetYield, currentYield));
  if (firstUpwardBlock != null) windowEndYield = Math.min(windowEndYield, firstUpwardBlock + 1);
  // Today's bar is never off her own chart.
  windowEndYield = Math.max(windowEndYield, currentYield, windowStartYield);

  // --- the ladder ---
  const options: YieldOption[] = [];
  for (let n = windowStartYield; n <= windowEndYield; n += 1) {
    const variable = variableAt(n);
    const total = totalAt(n);
    const blocks = blocksAt(n, activeAll);
    options.push({
      yieldUnits: n,
      isCurrent: n === currentYield,
      unitWeightMilligrams: weightAt(n),
      ingredientsCentsPerUnit: l1 / n,
      extrasCentsPerUnit: l2,
      overheadCentsPerUnit: l3 / n,
      variableCentsPerUnit: variable,
      totalCentsPerUnit: total,
      // Same expression order as the cost engine, so a row and the cost card
      // can never disagree by a point. See the note in costing.ts.
      grossMarginPercent: price != null ? Math.round(((price - variable) * 100) / price) : null,
      netMarginPercent: price != null ? Math.round(((price - total) * 100) / price) : null,
      grossMarginExact: price != null ? ((price - variable) * 100) / price : null,
      netMarginExact: price != null ? ((price - total) * 100) / price : null,
      reachesTarget: reaches(n),
      priceToReachTargetCents: priceToReachTargetAt(n),
      blocks,
      blocked: isBlocking(blocks),
    });
  }

  const currentRow = options.find((o) => o.isCurrent) ?? null;

  // --- the verdict ---
  let bindingConstraint: BlockKind | null = null;
  let bindingConstraintOnsetYield: number | null = null;
  let relaxingBindingAloneReachesTarget = false;

  if (targetYield != null) {
    const blocking = blocksAt(targetYield, activeAll).filter((b) => b.severity === "blocking");
    if (blocking.length > 0) {
      // Only fences that actually block the ANSWER are candidates. A minYield
      // blocking yields below the answer has nothing to do with why she
      // cannot reach it.
      const ranked = blocking
        .map((b) => ({ kind: b.kind, onset: onsetYield(b.kind) ?? Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => a.onset - b.onset || precedence(a.kind) - precedence(b.kind));
      bindingConstraint = ranked[0].kind;
      bindingConstraintOnsetYield = ranked[0].onset === Number.MAX_SAFE_INTEGER ? null : ranked[0].onset;
      const without = activeAll.filter((k) => k !== bindingConstraint);
      relaxingBindingAloneReachesTarget = !isBlocking(blocksAt(targetYield, without));
    }
  }

  const targetYieldNetMarginPercent =
    targetYield != null && price != null
      ? Math.round(((price - totalAt(targetYield)) / price) * 100)
      : null;

  const verdict = buildVerdict({
    hasCost,
    impossibleTarget,
    price,
    target,
    unreachable,
    ceilingPercent,
    ceilingPercentExact,
    l2,
    targetYield,
    targetYieldInWindow: targetYield != null && targetYield <= windowEndYield && targetYield >= windowStartYield,
    targetYieldNetMarginPercent,
    currentYield,
    currentReaches: currentRow?.reachesTarget ?? false,
    currentBlocked: currentRow?.blocked ?? false,
    bindingConstraint,
    bindingConstraintOnsetYield,
    relaxingBindingAloneReachesTarget,
    constraintNote: c.constraintNote?.trim() || null,
    maxYield: c.maxYield,
  });

  return {
    currentYield,
    priceCents: price,
    targetGrossMarginPercent: target,
    priceToReachTargetAtCurrentYieldCents: currentRow?.priceToReachTargetCents ?? null,
    priceToReachTargetAtCurrentYieldBlocks: currentRow?.blocks ?? [],
    options,
    windowStartYield,
    windowEndYield,
    ceilingPercentExact,
    verdict,
    contradictoryConstraints,
    feedbackWarnings,
  };
}

/** Fixed tie-break when two fences share an onset. Physical limits before
 * chosen ones: the tray can only be cut so fine. */
function precedence(kind: BlockKind): number {
  return ["unitWeightFloor", "maxYield", "maxPrice", "minYield", "minPrice"].indexOf(kind);
}

interface VerdictInput {
  hasCost: boolean;
  impossibleTarget: boolean;
  price: number | null;
  target: number | null;
  unreachable: boolean;
  ceilingPercent: number | null;
  ceilingPercentExact: number | null;
  l2: number;
  targetYield: number | null;
  targetYieldInWindow: boolean;
  targetYieldNetMarginPercent: number | null;
  currentYield: number;
  currentReaches: boolean;
  currentBlocked: boolean;
  bindingConstraint: BlockKind | null;
  bindingConstraintOnsetYield: number | null;
  relaxingBindingAloneReachesTarget: boolean;
  constraintNote: string | null;
  maxYield: number | null;
}

/**
 * Every sentence here is a statement of arithmetic. No imperatives, no
 * "should", no congratulation — she is running a business, not being marked.
 */
function buildVerdict(v: VerdictInput): Verdict {
  const base = {
    ceilingPercentExact: v.ceilingPercentExact,
    ceilingPercent: v.ceilingPercent,
    layer2CentsPerUnit: v.l2,
    targetYield: v.targetYield,
    targetYieldInWindow: v.targetYieldInWindow,
    targetYieldNetMarginPercent: v.targetYieldNetMarginPercent,
    bindingConstraint: v.bindingConstraint,
    bindingConstraintOnsetYield: v.bindingConstraintOnsetYield,
    relaxingBindingAloneReachesTarget: v.relaxingBindingAloneReachesTarget,
    constraintNote: v.constraintNote,
  };

  if (!v.hasCost) {
    return {
      ...base,
      kind: "noCost",
      headline: "Nothing costed yet",
      detail: "Add what goes into this and Sous can work out what it needs to earn.",
    };
  }
  if (v.impossibleTarget) {
    return {
      ...base,
      kind: "impossibleTarget",
      headline: "That target cannot exist",
      detail: "A gross margin of 100% would need an infinite price, and a negative one is not a target. Anything from 0 to 99 works.",
    };
  }
  if (v.target == null) {
    return {
      ...base,
      kind: "noTarget",
      headline: "No target set",
      detail: "Set a target gross margin and Sous will work out which prices and yields reach it.",
    };
  }
  if (v.price == null) {
    return {
      ...base,
      kind: "noPrice",
      headline: "No price set",
      detail: `Below is what you would charge at each yield to reach ${v.target}%.`,
    };
  }
  if (v.unreachable) {
    return {
      ...base,
      kind: "asymptote",
      headline: `${v.target}% is out of reach at ${money(v.price)}`,
      detail: `Packaging costs ${money(v.l2)} a unit whether you cut the tray into 10 or 40, so at ${money(v.price)} gross margin cannot pass ${v.ceilingPercent}% however fine you cut. Cutting more will not close this; the price or the packaging would have to move.`,
    };
  }
  if (v.currentReaches && !v.currentBlocked) {
    return {
      ...base,
      kind: "alreadyAtTarget",
      headline: `${v.currentYield} a tray already reaches ${v.target}%`,
      detail: `At ${money(v.price)} you are at or above your target. Below is what the rest of the range looks like.`,
    };
  }
  if (v.bindingConstraint == null) {
    return {
      ...base,
      kind: "reachable",
      headline: `${v.target}% arrives at ${v.targetYield} a tray`,
      detail:
        v.targetYieldNetMarginPercent != null && v.targetYieldNetMarginPercent < 0
          ? `At ${money(v.price)}, cutting into ${v.targetYield} reaches your target gross margin — though net is still ${v.targetYieldNetMarginPercent}% once your time, gas and power are counted.`
          : `At ${money(v.price)}, cutting into ${v.targetYield} reaches it.`,
    };
  }
  return {
    ...base,
    kind: "blocked",
    headline: `${v.target}% would need ${v.targetYield} a tray`,
    detail: `${fenceSentence(v)} ${
      v.relaxingBindingAloneReachesTarget
        ? "Moving that one limit would be enough."
        : "Moving that limit alone would not be enough — another one stands behind it."
    }`,
  };
}

function fenceSentence(v: VerdictInput): string {
  const at = v.bindingConstraintOnsetYield;
  switch (v.bindingConstraint) {
    case "unitWeightFloor":
      return `Your smallest-size limit stops you${at != null ? ` at ${at}` : ""}.`;
    case "maxYield":
      return `Your limit of ${v.maxYield ?? at} a tray stops you first.`;
    case "maxPrice":
      return "The price that would take is above the ceiling you set.";
    case "minYield":
      return "That is fewer than the fewest you said you would cut.";
    default:
      return "A limit you set stands in the way.";
  }
}

// --- Formatting -----------------------------------------------------------

function money(cents: number): string {
  const abs = Math.abs(cents) / 100;
  return `${cents < 0 ? "−" : ""}$${abs.toFixed(2)}`;
}

function grams(milligrams: number): string {
  const g = milligrams / 1000;
  return `${Number.isInteger(g) ? g : Math.round(g * 10) / 10} g`;
}
