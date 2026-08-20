import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { ownerMutation, ownerQuery, type OrgCtx, type QueryCtx } from "./lib/functions";
import { daySpan, MS_DAY, pnlFor, requireProvisioned, shiftDay, toDay } from "./dashboard";
import { periodCauses } from "./lib/pnl";
import { costItem } from "./lib/costing";
import { optimise } from "./lib/optimiser";
import { loadWorld } from "./lib/world";
import {
  rankRecommendations,
  type StructuralFacts,
  type Trend,
  type TrendPoint,
} from "./lib/recommendations";
import { lineTotalCents } from "../lib/invoice-totals";

/**
 * Every suggestion Sous has, in one place.
 *
 * She was never going to open twelve menu items to find out which one needs
 * attention, so this collects what the optimiser, the drift check, the
 * production log, the delivery figures, the order history and the price clock
 * each know separately, and ranks the lot by money.
 *
 * The arithmetic lives in convex/lib/recommendations.ts, pure and unit-tested.
 * This file only reads. In particular the PERIOD half comes from
 * `pnl.periodCauses` — the identical atoms Home's leak sentences are grouped
 * from — so "the one thing hurting it" and the top of this list are the same
 * money rather than two computations that happen to agree today.
 *
 * ownerQuery throughout: every figure here is a cost or a margin, and staff
 * never see either (CONTEXT.md — Access; DESIGN.md NEVER SHIP).
 */

/** Two equal windows: nothing sold in the recent one, something in the one
 * before it. Equal so the comparison is like for like. */
const DORMANT_WINDOW_DAYS = 60;
/** Long enough that an ordinary season passing does not trip it. */
const STALE_PRICE_DAYS = 90;
/** Below this a "typical order size" is one anecdote, not a typical. */
const MIN_ORDERS_FOR_TYPICAL = 3;
/**
 * The optimiser is a solver, and running it for every item on every load would
 * put a search loop in front of a screen she opens on 3G. Candidates are
 * ranked by a cheap proxy first — margin shortfall × revenue, both of which
 * the cost engine already has — and only the worst are solved properly. When
 * the cap bites, the screen SAYS SO: a silent truncation reads as "we checked
 * everything".
 */
const OPTIMISER_CAP = 20;

const HISTORY_DAYS = DORMANT_WINDOW_DAYS * 2;

interface ItemHistory {
  /** Domain days this item was delivered on, ascending. */
  days: string[];
  /** Total units per order, for the median. */
  orderUnits: number[];
  /** Units delivered per day, for the sparkline. */
  unitsByDay: Map<string, number>;
  recentUnitsMilli: number;
  priorRevenueCents: number;
}

/**
 * Order history for the trailing 120 days, keyed by menu item.
 *
 * `orderLines` carries no date and has only two indexes, so "when was this
 * last ordered" is not a lookup — it is a scan of the orders in the window
 * joined to their lines. That is the same shape dashboard.ts already uses, and
 * at one kitchen's volume it is a cheap read; if this ever runs against a
 * hundred kitchens' worth of history it wants an index, not a rewrite.
 */
async function loadHistory(
  ctx: QueryCtx & OrgCtx,
  end: string,
): Promise<Map<string, ItemHistory>> {
  const start = shiftDay(end, -(HISTORY_DAYS - 1));
  // The boundary between the two halves: on or after it is "recent".
  const boundary = shiftDay(end, -(DORMANT_WINDOW_DAYS - 1));

  const orders = (
    await ctx.db
      .query("orders")
      .withIndex("by_org_deliveryDate", (q) =>
        q.eq("orgId", ctx.orgId).gte("deliveryDate", start).lte("deliveryDate", end),
      )
      .collect()
  ).filter((o) => o.status !== "cancelled");
  if (orders.length === 0) return new Map();

  const dateByOrder = new Map(orders.map((o) => [o._id as string, o.deliveryDate]));
  const lines = await ctx.db
    .query("orderLines")
    .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
    .collect();

  const byItem = new Map<string, ItemHistory>();
  // Per (item, order), so "a typical order is 3" counts an order once even
  // when it was split across two lines.
  const perOrder = new Map<string, number>();

  for (const line of lines) {
    if (!line.menuItemId) continue;
    const day = dateByOrder.get(line.orderId);
    if (!day) continue;
    const id = line.menuItemId as string;
    let row = byItem.get(id);
    if (!row) {
      row = {
        days: [],
        orderUnits: [],
        unitsByDay: new Map(),
        recentUnitsMilli: 0,
        priorRevenueCents: 0,
      };
      byItem.set(id, row);
    }
    row.days.push(day);
    row.unitsByDay.set(day, (row.unitsByDay.get(day) ?? 0) + line.qtyMilli);
    const key = `${id}|${line.orderId}`;
    perOrder.set(key, (perOrder.get(key) ?? 0) + line.qtyMilli);
    if (day >= boundary) row.recentUnitsMilli += line.qtyMilli;
    else {
      // The same rounding the invoice printed, so "it earned $41" is the $41
      // her customers were actually billed.
      row.priorRevenueCents += lineTotalCents({
        description: "",
        qtyMilli: line.qtyMilli,
        unitPriceCents: line.unitPriceCents,
      });
    }
  }

  for (const [key, qtyMilli] of perOrder) {
    const id = key.slice(0, key.indexOf("|"));
    byItem.get(id)?.orderUnits.push(qtyMilli / 1000);
  }
  for (const row of byItem.values()) row.days.sort();

  return byItem;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Units per WEEK over the window, for the dormancy sparkline. Weekly rather
 * than daily because a home kitchen's daily line is mostly zeroes, and a chart
 * of zeroes argues nothing (DESIGN.md §5). */
function weeklyUnits(history: ItemHistory, end: string): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let week = HISTORY_DAYS / 7 - 1; week >= 0; week -= 1) {
    const weekEnd = shiftDay(end, -week * 7);
    const weekStart = shiftDay(weekEnd, -6);
    let units = 0;
    for (const [day, qtyMilli] of history.unitsByDay) {
      if (day >= weekStart && day <= weekEnd) units += qtyMilli / 1000;
    }
    points.push({ date: weekEnd, value: units });
  }
  return points;
}

/**
 * The structural half: conditions that are not bounded by the period she
 * picked, and therefore state their own window on the card.
 */
async function loadStructural(
  ctx: QueryCtx & OrgCtx,
  end: string,
  soldUnitsMilli: Map<string, number>,
): Promise<{
  facts: StructuralFacts[];
  trends: Record<string, Trend>;
  optimiserCapped: number;
}> {
  const items = await ctx.db
    .query("menuItems")
    .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  const sellable = items.filter((i) => !i.notSoldDirectly);
  if (sellable.length === 0) return { facts: [], trends: {}, optimiserCapped: 0 };

  const byItem = await loadHistory(ctx, end);
  const world = await loadWorld(ctx);
  const endInstant = Date.parse(`${end}T00:00:00Z`) + MS_DAY - 1;

  // --- who gets the solver run on them ---
  // A cheap proxy first: how many points below target, times what the item
  // actually earned. Both come from the cost engine and the period, neither
  // needs the solver, and the ordering is the same one the solver would
  // produce for anything but a hairline tie.
  const costings = new Map(sellable.map((i) => [i._id as string, costItem(i._id, world)]));
  const candidates = sellable
    .filter((item) => {
      const c = costings.get(item._id)!;
      return (
        c.belowTarget &&
        c.targetGrossMarginPercent != null &&
        c.grossMarginPercent != null &&
        (soldUnitsMilli.get(item._id) ?? 0) > 0
      );
    })
    .map((item) => {
      const c = costings.get(item._id)!;
      return {
        item,
        weight:
          (c.targetGrossMarginPercent! - c.grossMarginPercent!) *
          (soldUnitsMilli.get(item._id) ?? 0),
      };
    })
    .sort((a, b) => b.weight - a.weight);
  const solved = candidates.slice(0, OPTIMISER_CAP);

  const underpricedById = new Map<string, StructuralFacts["underpriced"]>();
  for (const { item } of solved) {
    const costing = costings.get(item._id)!;
    const result = optimise({
      costing,
      constraints: {
        minPriceCents: item.minPriceCents ?? null,
        maxPriceCents: item.maxPriceCents ?? null,
        minYield: item.minYield ?? null,
        maxYield: item.maxYield ?? null,
        unitWeightFloorMilligrams: item.unitWeightFloorMilligrams ?? null,
        constraintNote: item.constraintNote ?? null,
      },
    });
    const needed = result.priceToReachTargetAtCurrentYieldCents;
    // No arithmetic means no recommendation. "Charge more" without a figure is
    // the advice this product exists not to give.
    if (needed == null || costing.priceCents == null) continue;
    if (needed <= costing.priceCents) continue;
    underpricedById.set(item._id, {
      priceNowCents: costing.priceCents,
      priceToReachTargetCents: needed,
      targetPercent: costing.targetGrossMarginPercent!,
      grossMarginNowPercent: costing.grossMarginPercent,
      unitsMilli: soldUnitsMilli.get(item._id) ?? 0,
      // When a fence rather than the price is what stands in the way, the
      // optimiser's own sentence says which — better than this file guessing.
      verdictHeadline:
        result.verdict.kind === "blocked" || result.verdict.kind === "asymptote"
          ? result.verdict.headline
          : null,
    });
  }

  // --- the per-item facts ---
  const facts: StructuralFacts[] = [];
  const trends: Record<string, Trend> = {};

  for (const item of sellable) {
    const id = item._id as string;
    const history = byItem.get(id);
    const row: StructuralFacts = { menuItemId: id, name: item.name };

    const underpriced = underpricedById.get(id);
    if (underpriced) row.underpriced = underpriced;

    if (
      history &&
      history.recentUnitsMilli === 0 &&
      history.priorRevenueCents > 0 &&
      history.days.length > 0
    ) {
      const lastOrderedDay = history.days[history.days.length - 1];
      row.dormant = {
        lastOrderedDay,
        quietDays: daySpan(lastOrderedDay, end) - 1,
        windowDays: DORMANT_WINDOW_DAYS,
        priorRevenueCents: history.priorRevenueCents,
      };
      trends[`item:${id}`] = {
        label: "Units a week",
        points: weeklyUnits(history, end),
      };
    }

    // A base batch bigger than a typical order is wasteful before any recipe
    // arithmetic happens — but only if "typical" means something, which needs
    // more than one or two orders behind it.
    if (history && history.orderUnits.length >= MIN_ORDERS_FOR_TYPICAL) {
      const typical = Math.round(median(history.orderUnits));
      if (typical > 0 && item.baseBatchYield > typical) {
        row.batch = { baseBatchYield: item.baseBatchYield, typicalOrderUnits: typical };
      }
    }

    // Absent priceSetAt means the item predates the field: Sous does not know
    // how long it has been priced that way, and says nothing rather than
    // guessing "never".
    if (item.priceSetAt != null && item.priceCents != null) {
      const days = Math.floor((endInstant - item.priceSetAt) / MS_DAY);
      if (days >= STALE_PRICE_DAYS) {
        row.stalePrice = { priceSetDay: toDay(item.priceSetAt), days };
      }
    }

    if (row.underpriced || row.dormant || row.batch || row.stalePrice) {
      facts.push(row);
    }
  }

  return { facts, trends, optimiserCapped: Math.max(0, candidates.length - solved.length) };
}

/** What each drifted ingredient has actually cost, purchase by purchase.
 * Trend IS the argument on a drift card, which is why this one gets a line. */
async function driftTrends(
  ctx: QueryCtx & OrgCtx,
  ingredientIds: string[],
  end: string,
): Promise<Record<string, Trend>> {
  const start = Date.parse(`${shiftDay(end, -(HISTORY_DAYS - 1))}T00:00:00Z`);
  const trends: Record<string, Trend> = {};
  for (const id of ingredientIds) {
    const purchases = await ctx.db
      .query("purchases")
      .withIndex("by_org_ingredient_time", (q) =>
        q.eq("orgId", ctx.orgId).eq("ingredientId", id as Id<"ingredients">).gte("purchasedAt", start),
      )
      .collect();
    if (purchases.length === 0) continue;
    trends[`ingredient:${id}`] = {
      label: "What you paid",
      points: purchases
        .map((p) => ({ date: toDay(p.purchasedAt), value: p.unitPriceCentsPerThousand }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  }
  return trends;
}

const periodArgs = {
  /** Inclusive domain days. Absent start = all time. */
  start: v.optional(v.string()),
  end: v.string(),
} as const;

export const list = ownerQuery({
  args: periodArgs,
  handler: async (ctx, { start, end }) => {
    const org = requireProvisioned(ctx.org);
    const { input, pnl } = await pnlFor(ctx, org, start, end);
    const period = periodCauses(pnl, input);

    // What each item sold in the WINDOW she picked — the volume that turns a
    // per-unit price gap into money.
    const soldUnitsMilli = new Map<string, number>();
    for (const order of input.orders) {
      for (const line of order.lines) {
        if (!line.menuItemId) continue;
        soldUnitsMilli.set(
          line.menuItemId,
          (soldUnitsMilli.get(line.menuItemId) ?? 0) + line.qtyMilli,
        );
      }
    }

    const [{ facts, trends, optimiserCapped }, drifts, dismissalRows] = await Promise.all([
      loadStructural(ctx, end, soldUnitsMilli),
      driftTrends(
        ctx,
        input.drift.map((d) => d.ingredientId),
        end,
      ),
      ctx.db
        .query("recommendationDismissals")
        .withIndex("by_org_subject", (q) => q.eq("orgId", ctx.orgId))
        .collect(),
    ]);

    const result = rankRecommendations({
      base: `/${org.slug}`,
      period,
      structural: facts,
      trends: { ...trends, ...drifts },
      dismissals: dismissalRows.map((d) => ({
        subjectKey: d.subjectKey,
        dismissedAt: d.dismissedAt,
        dismissedAtCents: d.dismissedAtCents,
        causeKinds: d.causeKinds,
      })),
    });

    return {
      ...result,
      /** Stated on the screen when it bites. Silence here would read as
       * "every item was checked", which would be a lie. */
      optimiserCapped,
      /** Zero menu items is a different screen from nothing being wrong. */
      hasAnyItem: pnl.orderCount > 0 || facts.length > 0,
    };
  },
});

/**
 * Set one aside, recording the FIGURE she accepted rather than a flag.
 *
 * The same reasoning as menuItems.optimiserSetAsideMarginPercent: a boolean
 * leaves nothing to answer "why is this quiet?" in six months, and nothing to
 * decide when it should stop being. Stored, the condition itself brings the
 * card back — the money moving materially, or a new cause attaching.
 */
export const dismiss = ownerMutation({
  args: {
    subjectKey: v.string(),
    cents: v.number(),
    causeKinds: v.array(v.string()),
  },
  handler: async (ctx, { subjectKey, cents, causeKinds }) => {
    if (subjectKey.trim() === "") throw new Error("Nothing to set aside.");
    const existing = await ctx.db
      .query("recommendationDismissals")
      .withIndex("by_org_subject", (q) =>
        q.eq("orgId", ctx.orgId).eq("subjectKey", subjectKey),
      )
      .unique();
    const fields = {
      dismissedAt: Date.now(),
      dismissedAtCents: Math.round(cents),
      causeKinds,
      dismissedBy: ctx.userId,
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("recommendationDismissals", { orgId: ctx.orgId, subjectKey, ...fields });
    return null;
  },
});

/** Pick it back up. Deleting the row is right: the record of the decision was
 * only ever there to keep the card quiet, and she has just reversed it. */
export const restore = ownerMutation({
  args: { subjectKey: v.string() },
  handler: async (ctx, { subjectKey }) => {
    const existing = await ctx.db
      .query("recommendationDismissals")
      .withIndex("by_org_subject", (q) =>
        q.eq("orgId", ctx.orgId).eq("subjectKey", subjectKey),
      )
      .unique();
    if (!existing) throw new ConvexError({ code: "NOT_FOUND" as const });
    await ctx.db.delete(existing._id);
    return null;
  },
});
