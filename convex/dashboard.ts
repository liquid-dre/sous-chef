import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { ownerQuery, type OrgCtx, type QueryCtx } from "./lib/functions";
import { driftFor } from "./lib/drift";
import { isLive, snapshotTotalCents } from "./production";
import {
  costTree,
  dailySeries,
  periodPnl,
  rankCustomers,
  rankItems,
  rankLeaks,
  rankOrders,
  sankeyFrom,
  type PnlDrift,
  type PnlOrder,
  type PnlWaste,
} from "./lib/pnl";

/**
 * Home: the claim, and the evidence behind it.
 *
 * Split into two queries on purpose. `claim` returns the sentence she opens
 * Sous to read; `breakdown` does the heavy ranking work that sits behind it.
 * She has thirty seconds and a mid-range Android on 3G — the sentence must not
 * wait for the analysis, and the analysis' charts are dynamically imported so
 * their JavaScript is off the critical path entirely.
 *
 * ownerQuery throughout, and not by accident: every figure on this screen is a
 * cost or a margin, and staff never see either (CONTEXT.md — Access; DESIGN.md
 * NEVER SHIP). There is no staff-visible variant of this screen to get wrong.
 */

export const MS_DAY = 86_400_000;

export function toDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  return toDay(Date.parse(`${day}T00:00:00Z`) + days * MS_DAY);
}

/** Whole days between two domain days, inclusive of both ends. */
export function daySpan(start: string, end: string): number {
  return (
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / MS_DAY) + 1
  );
}

/**
 * Everything the period needs, read once.
 *
 * Deliberately one pass: `claim` and `breakdown` both need the same orders and
 * lines, and reading them twice would double the cost of the screen for a
 * payload difference. What differs between the two queries is how much
 * COMPUTATION and how much PAYLOAD, not how much reading.
 */
async function loadPeriod(
  ctx: QueryCtx & OrgCtx,
  start: string | undefined,
  end: string,
) {
  const orderRows = await ctx.db
    .query("orders")
    // The index comment already says "revenue recognition" — this is the
    // caller it was written for.
    .withIndex("by_org_deliveryDate", (q) =>
      start
        ? q.eq("orgId", ctx.orgId).gte("deliveryDate", start).lte("deliveryDate", end)
        : q.eq("orgId", ctx.orgId).lte("deliveryDate", end),
    )
    .collect();
  // Cancelled orders earned nothing. Their production cost still counts, but
  // it counts as waste through the production log, not as an order.
  const live = orderRows.filter((o) => o.status !== "cancelled");

  const lineRows = await ctx.db
    .query("orderLines")
    .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  const linesByOrder = new Map<string, Doc<"orderLines">[]>();
  for (const line of lineRows) {
    const bucket = linesByOrder.get(line.orderId);
    if (bucket) bucket.push(line);
    else linesByOrder.set(line.orderId, [line]);
  }

  const names = new Map<string, string>();
  const customerNames = new Map<string, string>();
  for (const order of live) {
    if (order.customerId && !customerNames.has(order.customerId)) {
      const c = await ctx.db.get(order.customerId);
      customerNames.set(order.customerId, c?.name ?? "(removed)");
    }
  }

  const orders: PnlOrder[] = [];
  for (const order of live) {
    const lines = linesByOrder.get(order._id) ?? [];
    for (const line of lines) {
      if (line.menuItemId && !names.has(line.menuItemId)) {
        const item = await ctx.db.get(line.menuItemId);
        names.set(line.menuItemId, item?.name ?? "(removed)");
      }
    }
    orders.push({
      id: order._id,
      deliveryDate: order.deliveryDate,
      customerId: order.customerId ?? null,
      /** Threaded through for the occasion mix. Absent means she tapped no
       * chip, which contacts.occasionMix excludes rather than bucketing. */
      occasion: order.occasion ?? null,
      customerName: order.customerId
        ? (customerNames.get(order.customerId) ?? "(removed)")
        : "Counter sales",
      discountCents: order.discountCents,
      deliveryFeeCents: order.deliveryFeeCents,
      deliveryCostCents: order.deliveryCostCents,
      taxRateBpAtCreation: order.taxRateBpAtCreation,
      taxInclusiveAtCreation: order.taxInclusiveAtCreation,
      lines: lines.map((l) => ({
        menuItemId: l.menuItemId ?? null,
        description: l.menuItemId
          ? (names.get(l.menuItemId) ?? "(removed)")
          : (l.description ?? "Off-menu"),
        qtyMilli: l.qtyMilli,
        unitPriceCents: l.unitPriceCents,
        cogsSnapshot: l.cogsSnapshot ?? null,
      })),
    });
  }

  return { orders, live, linesByOrder, names };
}

/**
 * Waste recognised IN the window, whoever it was baked for.
 *
 * Bench waste is dated by the bake; expired overhang is dated by its expiry,
 * which is the whole reason the period basis exists. A batch made in July for
 * a July order that rotted in August is an August loss — that is when the food
 * actually stopped being sellable.
 */
async function loadWaste(
  ctx: QueryCtx & OrgCtx,
  start: string | undefined,
  end: string,
): Promise<PnlWaste[]> {
  const logs = await ctx.db
    .query("productionLogs")
    .withIndex("by_org_producedAt", (q) => q.eq("orgId", ctx.orgId))
    .collect();

  const names = new Map<string, string>();
  const out: PnlWaste[] = [];
  const inWindow = (day: string) => day <= end && (start === undefined || day >= start);
  // End of the window as an instant, so "expired by then" is asked as at the
  // end of the period rather than as at now.
  const endInstant = Date.parse(`${end}T00:00:00Z`) + MS_DAY - 1;

  for (const log of logs) {
    if (!names.has(log.menuItemId)) {
      const item = await ctx.db.get(log.menuItemId);
      names.set(log.menuItemId, item?.name ?? "(removed)");
    }
    const name = names.get(log.menuItemId)!;
    const perUnit = snapshotTotalCents(log.cogsSnapshot);

    // Bench waste: dropped, burnt, given away. Dated by the bake.
    if (log.wasteQtyMilli > 0 && inWindow(log.producedOn)) {
      out.push({
        menuItemId: log.menuItemId,
        name,
        day: log.producedOn,
        qtyMilli: log.wasteQtyMilli,
        valueCents: Math.round((perUnit * log.wasteQtyMilli) / 1000),
      });
    }

    // Overhang that went off. Derived, never swept — same rule as everywhere
    // else it is asked (convex/production.ts).
    if (log.overhangRemainingQtyMilli > 0 && !isLive(log, endInstant)) {
      const expiredOn = log.overhangExpiresAt ? toDay(log.overhangExpiresAt) : log.producedOn;
      if (inWindow(expiredOn)) {
        out.push({
          menuItemId: log.menuItemId,
          name,
          day: expiredOn,
          qtyMilli: log.overhangRemainingQtyMilli,
          valueCents: Math.round((perUnit * log.overhangRemainingQtyMilli) / 1000),
        });
      }
    }
  }
  return out;
}

/**
 * What the period's cooking really cost, against what it was costed at.
 *
 * Consumption comes from the production logs' own recipe lines rather than
 * from stockMovements, because movements only exist for ingredients she has
 * chosen to track — and an untracked ingredient still drifts. The known blind
 * spot is different and is stated on the leak itself: an ingredient bought
 * fewer than three times has no drift signal at all (CONTEXT.md).
 */
async function loadDrift(
  ctx: QueryCtx & OrgCtx,
  org: Doc<"orgs">,
  start: string | undefined,
  end: string,
): Promise<PnlDrift[]> {
  const logs = (
    await ctx.db
      .query("productionLogs")
      .withIndex("by_org_producedAt", (q) => q.eq("orgId", ctx.orgId))
      .collect()
  ).filter((l) => l.producedOn <= end && (start === undefined || l.producedOn >= start));
  if (logs.length === 0) return [];

  // How much of each ingredient the period actually consumed.
  const consumedMilli = new Map<string, number>();
  const recipeByItem = new Map<string, Doc<"recipeLines">[]>();
  for (const log of logs) {
    let recipe = recipeByItem.get(log.menuItemId);
    if (!recipe) {
      recipe = await ctx.db
        .query("recipeLines")
        .withIndex("by_org_menuItem", (q) =>
          q.eq("orgId", ctx.orgId).eq("menuItemId", log.menuItemId),
        )
        .collect();
      recipeByItem.set(log.menuItemId, recipe);
    }
    for (const line of recipe) {
      // Direct raw lines only — a sub-recipe's ingredients are consumed by
      // the sub's own production log, and counting them here would double.
      if (line.componentType !== "ingredient") continue;
      const id = line.componentId;
      consumedMilli.set(id, (consumedMilli.get(id) ?? 0) + line.qtyMilli * log.batchCount);
    }
  }

  const out: PnlDrift[] = [];
  const now = Date.now();
  for (const [ingredientId, milli] of consumedMilli) {
    const ingredient = await ctx.db.get(ingredientId as Id<"ingredients">);
    if (!ingredient || ingredient.orgId !== ctx.orgId) continue;
    const recent = (
      await ctx.db
        .query("purchases")
        .withIndex("by_org_ingredient_time", (q) =>
          q.eq("orgId", ctx.orgId).eq("ingredientId", ingredient._id),
        )
        .order("desc")
        .take(3)
    ).map((p) => p.unitPriceCentsPerThousand);

    const drift = driftFor({
      standardCostCentsPerThousand: ingredient.standardCostCentsPerThousand,
      standardCostSetAt: ingredient.standardCostSetAt,
      recentUnitPrices: recent,
      thresholdPercent: org.costDriftThresholdPercent,
      now,
    });
    if (!drift.drifted || drift.medianCentsPerThousand === null) continue;

    const excessPerThousand =
      drift.medianCentsPerThousand - drift.standardCentsPerThousand;
    if (excessPerThousand <= 0) continue;
    out.push({
      ingredientId: ingredient._id,
      name: ingredient.name,
      excessCents: Math.round((excessPerThousand * milli) / 1_000_000),
    });
  }
  return out.sort((a, b) => b.excessCents - a.excessCents);
}

export function requireProvisioned(org: Doc<"orgs"> | null): Doc<"orgs"> {
  if (!org) throw new Error("This kitchen has not been set up yet.");
  return org;
}

/** Exported for convex/recommendations.ts, which ranks the same period causes
 * by subject rather than by kind. One computation, two groupings. */
export async function pnlFor(
  ctx: QueryCtx & OrgCtx,
  org: Doc<"orgs">,
  start: string | undefined,
  end: string,
) {
  const [{ orders }, waste, drift] = await Promise.all([
    loadPeriod(ctx, start, end),
    loadWaste(ctx, start, end),
    loadDrift(ctx, org, start, end),
  ]);
  const input = {
    orders,
    waste,
    drift,
    targetNetMarginPercent: org.targetNetMarginPercent ?? null,
  };
  return { input, pnl: periodPnl(input) };
}

const periodArgs = {
  /** Inclusive domain days. Absent start = all time. */
  start: v.optional(v.string()),
  end: v.string(),
} as const;

/**
 * The sentence. Small payload, minimal computation, and everything she needs
 * to decide whether to keep reading.
 */
export const claim = ownerQuery({
  args: periodArgs,
  handler: async (ctx, { start, end }) => {
    const org = requireProvisioned(ctx.org);
    const { input, pnl } = await pnlFor(ctx, org, start, end);
    const leaks = rankLeaks(pnl, input, `/${org.slug}`);

    // The previous equivalent window: the same number of days, ending the day
    // before this one starts. Comparing a part-month against a whole one is
    // how a dashboard tells someone they collapsed when they are three days in.
    let previous: number | null = null;
    if (start) {
      const span = daySpan(start, end);
      const prevEnd = shiftDay(start, -1);
      const prevStart = shiftDay(prevEnd, -(span - 1));
      previous = (await pnlFor(ctx, org, prevStart, prevEnd)).pnl.netMarginPercent;
    }

    // A rolling four weeks, always, whatever window she is looking at — it is
    // the steadier line to judge a spiky week against.
    const fourWeekEnd = end;
    const fourWeekStart = shiftDay(end, -27);
    const rolling = (await pnlFor(ctx, org, fourWeekStart, fourWeekEnd)).pnl
      .netMarginPercent;

    return {
      pnl,
      /** The one thing hurting it, and the rest in order behind it. */
      leaks,
      comparison: {
        previousPeriodMarginPercent: previous,
        rollingFourWeekMarginPercent: rolling,
      },
      /** Zero orders is a different screen from a bad month. */
      hasAnyOrder: pnl.orderCount > 0,
    };
  },
});

/**
 * The evidence. Everything behind a tap, computed only when asked for.
 */
export const breakdown = ownerQuery({
  args: periodArgs,
  handler: async (ctx, { start, end }) => {
    const org = requireProvisioned(ctx.org);
    const { input, pnl } = await pnlFor(ctx, org, start, end);

    // Minutes per unit, for the scatter's size buckets: an item's batch time
    // spread across the units that batch yields.
    const menuItemDocs = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const minutesPerUnit = new Map<string, number>(
      menuItemDocs.map((i) => [
        i._id as string,
        i.baseBatchYield > 0 ? i.batchProductionMinutes / i.baseBatchYield : 0,
      ]),
    );

    const items = rankItems(input.orders, minutesPerUnit);

    return {
      sankey: sankeyFrom(pnl),
      items,
      orders: rankOrders(input.orders),
      customers: rankCustomers(input.orders),
      /** Day grain. The client buckets it — aggregateByGrain picks the
       * coarsest necessary grain and states which, so 400 orders become ~13
       * weekly points rather than a smear. */
      series: dailySeries(input),
      costTree: costTree(pnl, items),
      targetNetMarginPercent: pnl.targetNetMarginPercent,
      /** Stated on the per-order list: waste belongs to no order, so this
       * list does not add up to the headline, and she should hear that from
       * Sous rather than discover it. */
      unattributedWasteCents: pnl.wasteCents,
    };
  },
});
