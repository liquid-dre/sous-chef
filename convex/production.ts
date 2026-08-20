import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  orgMutation,
  orgQuery,
  ownerQuery,
  type MutationCtx,
  type OrgCtx,
  type QueryCtx,
} from "./lib/functions";
import { costItem } from "./lib/costing";
import { loadWorld } from "./lib/world";
import { subRecipeShortfalls, type SubRecipeLine } from "./lib/stock";

/**
 * The production log: the record that a batch was actually made, with the
 * yield she actually got.
 *
 * This is the instrumentation for the leak nothing else in Sous can see. An
 * order asks for 3, a batch makes 5, the other 2 are given away or binned —
 * and every cost figure shipped before this slice quietly assumed the recipe
 * yields what it claims. The gap between expected and actual IS her real
 * waste rate, and it only becomes visible because this row exists.
 *
 * Two rules shape the file:
 *
 * 1. **Expiry is derived, never swept.** Overhang is live while
 *    `now < overhangExpiresAt` and waste after. There is no cron, so there is
 *    nothing that can silently stop running and leave rotten stock looking
 *    sellable — the same reasoning that makes payment status a sum and drift
 *    a computation.
 * 2. **What a unit costs is decided once, here.** The batch stamps its
 *    three-layer cost, and that stamp follows the unit out whichever exit it
 *    takes: sold down, it becomes the order line's snapshot; expired, it is
 *    what the waste is valued at.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_MS = 3_600_000;

export interface CogsSnapshot {
  ingredientsCents: number;
  perUnitExtrasCents: number;
  overheadCents: number;
}

function snapshotOf(costing: ReturnType<typeof costItem>): CogsSnapshot {
  // Per unit, integer cents — identical to what orders.create stamps, so a
  // unit costs the same whether it was baked to order or pulled off the shelf.
  return {
    ingredientsCents: Math.round(costing.ingredients.centsPerUnit),
    perUnitExtrasCents: Math.round(costing.extras.centsPerUnit),
    overheadCents: Math.round(costing.overhead.centsPerUnit),
  };
}

export function snapshotTotalCents(s: CogsSnapshot): number {
  return s.ingredientsCents + s.perUnitExtrasCents + s.overheadCents;
}

/** Live while there is something left and it has not expired. A batch with
 * no shelf life (a sub-recipe) never expires. */
export function isLive(log: Doc<"productionLogs">, at: number): boolean {
  return (
    log.overhangRemainingQtyMilli > 0 &&
    (log.overhangExpiresAt === undefined || log.overhangExpiresAt > at)
  );
}

/** The last moment of her delivery day, in UTC. Eligibility is judged here
 * rather than at "now" — see planSellDown. */
export function endOfDayMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1) + 86_400_000 - 1;
}

// --- The allocator --------------------------------------------------------

export interface Allocation {
  /** Null means "make it fresh" — the line carries the live cost. */
  productionLogId: Id<"productionLogs"> | null;
  qtyMilli: number;
  cogsSnapshot: CogsSnapshot;
}

/**
 * Which batches this line should come off, oldest first. Writes nothing.
 *
 * Eligibility is judged at the order's DELIVERY, not at now, and that is not
 * a refinement — it is the difference between working and corrupting data.
 * An order taken today for delivery in ten days against a 72-hour shelf life
 * would otherwise reserve today's overhang, those units would rot on day 4,
 * and when she finally bakes on day 9 the line already carries
 * `fulfilledFromProductionLogId` — so `log` excludes it from `consumed` and
 * the whole fresh batch books as overhang. Four units vaporised, twelve
 * units of stock invented, from one order.
 *
 * `producedAt <= deliveryInstant` is the other half: back-entering last
 * week's sale must not eat this morning's bake.
 *
 * `running` lets one order allocate across several lines of the same item
 * without handing the same units out twice.
 */
export async function planSellDown(
  ctx: (QueryCtx | MutationCtx) & OrgCtx,
  args: {
    menuItemId: Id<"menuItems">;
    qtyMilli: number;
    deliveryInstant: number;
    liveSnapshot: CogsSnapshot;
    running?: Map<string, number>;
  },
): Promise<Allocation[]> {
  const running = args.running ?? new Map<string, number>();
  const logs = await ctx.db
    .query("productionLogs")
    .withIndex("by_org_menuItem", (q) =>
      q.eq("orgId", ctx.orgId).eq("menuItemId", args.menuItemId),
    )
    // Ascending producedAt IS the FIFO order — oldest stock leaves first, so
    // it is sold before it can expire. Free from the index.
    .order("asc")
    .collect();

  const out: Allocation[] = [];
  let left = args.qtyMilli;

  for (const log of logs) {
    if (left <= 0) break;
    if (log.producedAt > args.deliveryInstant) continue;
    if (
      log.overhangExpiresAt !== undefined &&
      log.overhangExpiresAt <= args.deliveryInstant
    ) {
      continue;
    }
    const alreadyTaken = running.get(log._id) ?? 0;
    const available = log.overhangRemainingQtyMilli - alreadyTaken;
    if (available <= 0) continue;

    const take = Math.min(available, left);
    running.set(log._id, alreadyTaken + take);
    out.push({
      productionLogId: log._id,
      qtyMilli: take,
      cogsSnapshot: log.cogsSnapshot,
    });
    left -= take;
  }

  // Whatever stock could not cover is made fresh at today's cost.
  if (left > 0) {
    out.push({
      productionLogId: null,
      qtyMilli: left,
      cogsSnapshot: args.liveSnapshot,
    });
  }
  return out;
}

/**
 * Take the units off the batches.
 *
 * A stored counter, deliberately — and yes, payments refuse one. The
 * distinction is exact: a payment total is the sum of immutable inserts, so a
 * counter buys nothing and only risks drift. Overhang has no event stream to
 * sum; the allocation IS the event. The read-modify-write sits inside one
 * Convex transaction, so two taps racing on three units conflict and retry:
 * 3+0 or 2+1, never 3+3.
 */
export async function commitSellDown(
  ctx: MutationCtx & OrgCtx,
  allocations: Allocation[],
): Promise<void> {
  for (const a of allocations) {
    if (!a.productionLogId) continue;
    const log = await ctx.db.get(a.productionLogId);
    if (!log || log.orgId !== ctx.orgId) continue;
    await ctx.db.patch(log._id, {
      overhangRemainingQtyMilli: Math.max(
        0,
        log.overhangRemainingQtyMilli - a.qtyMilli,
      ),
    });
  }
}

/**
 * Put the units back on the shelf.
 *
 * They physically exist — a cancellation is about the sale, not the food. If
 * the batch has expired by now the returned units land in an expired batch
 * and read as waste immediately, which derived expiry gets right with no
 * extra code.
 */
export async function restoreSellDown(
  ctx: MutationCtx & OrgCtx,
  lines: Doc<"orderLines">[],
): Promise<number> {
  let returned = 0;
  for (const line of lines) {
    if (!line.fulfilledFromProductionLogId) continue;
    const log = await ctx.db.get(line.fulfilledFromProductionLogId);
    if (!log || log.orgId !== ctx.orgId) continue;
    // Only units that came OFF a shelf go back on one.
    //
    // `fulfilledFromProductionLogId` now also marks lines a batch was baked
    // FOR, so this guard is load-bearing: without it, cancelling an order
    // would credit its units back as overhang and quietly un-bake food that
    // exists. CONTEXT.md is explicit — if production was logged, the cost
    // stays on the books as waste. The batch this line points at having been
    // baked for this very order is exactly what tells the two apart.
    if ((log.orderIds as string[]).includes(line.orderId)) continue;
    await ctx.db.patch(log._id, {
      overhangRemainingQtyMilli:
        log.overhangRemainingQtyMilli + line.qtyMilli,
    });
    returned += line.qtyMilli;
  }
  return returned;
}

// --- Logging a batch ------------------------------------------------------

const logArgs = {
  menuItemId: v.id("menuItems"),
  /** Whole-batch multiples only. */
  batchCount: v.number(),
  actualYieldMilli: v.number(),
  orderIds: v.array(v.id("orders")),
  /** HER local day. */
  day: v.string(),
  /** Dropped on the floor, burnt, given to the neighbour. */
  wasteQtyMilli: v.optional(v.number()),
  wasteReason: v.optional(v.string()),
};

interface LogArgs {
  menuItemId: Id<"menuItems">;
  batchCount: number;
  actualYieldMilli: number;
  orderIds: Id<"orders">[];
  day: string;
  wasteQtyMilli?: number;
  wasteReason?: string;
}

/**
 * One batch, logged. Shared by `log` and `logWithSub` so the two cannot
 * diverge — a second copy of this would be a second place the pantry could
 * start telling a different story.
 */
async function logBatch(ctx: MutationCtx & OrgCtx, args: LogArgs) {
  {
    if (!DAY.test(args.day)) {
      throw new Error("Dates need to look like 2026-08-04.");
    }
    if (!Number.isFinite(args.batchCount) || args.batchCount <= 0) {
      throw new Error("A batch count has to be at least one.");
    }
    if (!Number.isFinite(args.actualYieldMilli) || args.actualYieldMilli < 0) {
      throw new Error("Actual yield cannot be negative.");
    }
    const wasteQtyMilli = args.wasteQtyMilli ?? 0;
    if (wasteQtyMilli < 0) throw new Error("Waste cannot be negative.");
    if (wasteQtyMilli > args.actualYieldMilli) {
      throw new Error("You cannot waste more than you made.");
    }

    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }

    // From the ITEM doc, never costing.yieldUnits — that silently becomes 1
    // on a zero yield, which would make the expected figure wrong rather
    // than loud.
    const expectedYieldMilli = Math.round(
      args.batchCount * item.baseBatchYield * 1000,
    );

    const world = await loadWorld(ctx);
    const cogsSnapshot = snapshotOf(costItem(item._id, world));

    // What the linked orders actually asked of THIS batch. Lines already
    // fulfilled from an earlier batch are excluded — counting them would
    // claim this batch covered something another one did.
    //
    // The lines are also KEPT, not just counted. Until this slice they were
    // identified here and thrown away, which is why nothing could say which
    // yield a customer's portion was cut at: the production log is the only
    // place a past `baseBatchYield` survives, and no line pointed at one.
    let consumedMilli = 0;
    const fedLines: { id: Id<"orderLines">; qtyMilli: number }[] = [];
    for (const orderId of args.orderIds) {
      const order = await ctx.db.get(orderId);
      if (!order || order.orgId !== ctx.orgId) {
        throw new ConvexError({ code: "NOT_FOUND" as const });
      }
      if (order.status === "cancelled") continue;
      const lines = await ctx.db
        .query("orderLines")
        .withIndex("by_org_order", (q) =>
          q.eq("orgId", ctx.orgId).eq("orderId", orderId),
        )
        .collect();
      for (const line of lines) {
        if (line.menuItemId !== item._id) continue;
        if (line.fulfilledFromProductionLogId) continue;
        consumedMilli += line.qtyMilli;
        fedLines.push({ id: line._id, qtyMilli: line.qtyMilli });
      }
    }

    const producedAt = Date.now();
    const sellable = Math.max(0, args.actualYieldMilli - wasteQtyMilli);
    // A shortfall is not negative overhang — she simply made less than the
    // orders needed, and the orders are still owed.
    const overhangQtyMilli = Math.max(0, sellable - consumedMilli);

    const productionLogId = await ctx.db.insert("productionLogs", {
      orgId: ctx.orgId,
      menuItemId: item._id,
      orderIds: args.orderIds,
      batchCount: args.batchCount,
      expectedYieldMilli,
      actualYieldMilli: args.actualYieldMilli,
      producedAt,
      producedOn: args.day,
      cogsSnapshot,
      overhangQtyMilli,
      overhangRemainingQtyMilli: overhangQtyMilli,
      overhangExpiresAt:
        item.shelfLifeHours != null
          ? producedAt + item.shelfLifeHours * HOUR_MS
          : undefined,
      wasteQtyMilli,
      wasteReason: args.wasteReason?.trim() || undefined,
    });

    // Point the lines this batch actually fed at it, so a rating on that
    // order can be traced to the yield the tray was cut at.
    //
    // Capped at what the batch could COVER, and a line is claimed only if it
    // fits whole in what is left. Two reasons, and the first is a bug this
    // guard exists to prevent: a batch that burnt entirely has `sellable = 0`
    // and must claim nothing, or the re-bake logged against the same order
    // would find every line already spoken for and treat its whole yield as
    // overhang. The second is honesty — a half-covered line came off two
    // batches at possibly two yields, so it stays unclaimed and the evidence
    // counts it as untraceable rather than guessing.
    let coverableMilli = sellable;
    for (const line of fedLines) {
      if (line.qtyMilli > coverableMilli) continue;
      coverableMilli -= line.qtyMilli;
      await ctx.db.patch(line.id, {
        fulfilledFromProductionLogId: productionLogId,
      });
    }

    // --- the pantry, the inverse of purchases.ts ---
    const recipeLines = await ctx.db
      .query("recipeLines")
      .withIndex("by_org_menuItem", (q) =>
        q.eq("orgId", ctx.orgId).eq("menuItemId", item._id),
      )
      .collect();

    for (const line of recipeLines) {
      // Direct raw lines only. A sub-recipe line draws on the SUB's finished
      // stock, which only exists if a batch of it was logged — recursing into
      // its raw ingredients would move stock with no production log behind
      // it (CONTEXT.md — Pantry). When the sub's shelf cannot cover the line,
      // `logWithSub` below logs a real batch of the sub, which deducts those
      // leaves the honest way: with a cost snapshot, a yield variance and an
      // overhang of its own.
      if (line.componentType !== "ingredient") continue;
      const ingredientId = line.componentId as Id<"ingredients">;
      const ingredient = await ctx.db.get(ingredientId);
      if (!ingredient || ingredient.orgId !== ctx.orgId) continue;
      // A level nothing ever deducts from could only ever rise, so
      // don't-track-stock ingredients get no movement — same rule purchases
      // applies on the way in.
      if (!ingredient.trackStock) continue;

      // The movement is the ONLY write, and that is the whole point: the
      // level is the sum of these rows (convex/lib/stock.ts), so two batches
      // logged at the same moment are two appends and neither deduction can
      // be lost. Nor is anything clamped at zero — going negative is the
      // evidence that the estimate has drifted from the shelf, and hiding it
      // would destroy the only signal she has.
      await ctx.db.insert("stockMovements", {
        orgId: ctx.orgId,
        ingredientId,
        deltaMilli: -Math.round(line.qtyMilli * args.batchCount),
        reason: "production",
        sourceId: productionLogId,
        occurredAt: producedAt,
      });
    }

    // --- and the sub-recipes, off their own finished stock ---
    //
    // CONTEXT.md — Pantry: "sub-recipe lines deduct from the sub's finished
    // stock on hand". Until this slice they deducted NOTHING, so a brownie
    // batch quietly ate two units of buttercream that stayed on the shelf
    // forever, and the same units could be sold again as overhang.
    //
    // FIFO through the same allocator orders use, so the oldest buttercream
    // leaves first and is sold before it can expire. Judged at `producedAt`
    // rather than at some delivery date: this is the moment the food was
    // physically used.
    const shortfalls: {
      menuItemId: Id<"menuItems">;
      name: string;
      neededMilli: number;
      shortMilli: number;
    }[] = [];
    for (const line of recipeLines) {
      if (line.componentType !== "menuItem") continue;
      const subId = line.componentId as Id<"menuItems">;
      const sub = await ctx.db.get(subId);
      if (!sub || sub.orgId !== ctx.orgId) continue;
      const neededMilli = Math.round(line.qtyMilli * args.batchCount);
      const allocations = await planSellDown(ctx, {
        menuItemId: subId,
        qtyMilli: neededMilli,
        deliveryInstant: producedAt,
        // Only ever attached to the make-fresh remainder, which
        // commitSellDown skips. Nothing is stamped from it.
        liveSnapshot: { ingredientsCents: 0, perUnitExtrasCents: 0, overheadCents: 0 },
      });
      await commitSellDown(ctx, allocations);
      const shortMilli = allocations
        .filter((a) => a.productionLogId === null)
        .reduce((sum, a) => sum + a.qtyMilli, 0);
      if (shortMilli > 0) {
        shortfalls.push({
          menuItemId: subId,
          name: sub.name,
          neededMilli,
          shortMilli,
        });
      }
    }

    return {
      productionLogId,
      expectedYieldMilli,
      consumedMilli,
      overhangQtyMilli,
      overhangExpiresAt:
        item.shelfLifeHours != null
          ? producedAt + item.shelfLifeHours * HOUR_MS
          : null,
      /**
       * Sub-recipes the shelf could not cover. REPORTED, never refused:
       * Sous flags, it never instructs, and she may well have made the
       * buttercream without logging it. The form offers "log a buttercream
       * batch too?" BEFORE she saves — see subRecipeCheck and logWithSub.
       */
      shortfalls,
    };
  }
}

export const log = orgMutation({
  args: logArgs,
  handler: async (ctx, args) => logBatch(ctx, args as LogArgs),
});

/**
 * "Log a buttercream batch too?" — one tap, both logs, one transaction.
 *
 * This is the promise CONTEXT.md makes and nothing has kept: a sub-recipe's
 * raw ingredients are NEVER deducted by recursion, because that would move
 * flour and butter with no production log behind them — no cost snapshot, no
 * yield variance, no overhang, no way to answer what a batch of buttercream
 * actually cost. So Sous logs a real batch of the sub instead, and the leaves
 * come off through the sub's own log.
 *
 * Order matters: the subs are logged FIRST so their finished stock exists by
 * the time the parent tries to draw on it. Both inside one Convex mutation,
 * so a failure anywhere leaves neither behind.
 */
export const logWithSub = orgMutation({
  args: {
    ...logArgs,
    subs: v.array(
      v.object({
        menuItemId: v.id("menuItems"),
        batchCount: v.number(),
        /** What she actually got. Defaults to the expected yield — she has
         * usually just made it and has no reason to disagree, and a figure
         * she was never asked for is better defaulted than invented. */
        actualYieldMilli: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { subs, ...args }) => {
    const subResults = [];
    for (const sub of subs) {
      const item = await ctx.db.get(sub.menuItemId);
      if (!item || item.orgId !== ctx.orgId) {
        throw new ConvexError({ code: "NOT_FOUND" as const });
      }
      const expected = Math.round(sub.batchCount * item.baseBatchYield * 1000);
      subResults.push({
        menuItemId: sub.menuItemId,
        name: item.name,
        ...(await logBatch(ctx, {
          menuItemId: sub.menuItemId,
          batchCount: sub.batchCount,
          actualYieldMilli: sub.actualYieldMilli ?? expected,
          // Nobody ordered the buttercream. It exists to be used.
          orderIds: [],
          day: args.day,
        })),
      });
    }
    const parent = await logBatch(ctx, args as LogArgs);
    return { ...parent, subs: subResults };
  },
});

// --- Reading --------------------------------------------------------------

/**
 * Would this bake run out of a sub-recipe, and how many batches would cover
 * it? Asked BEFORE she saves, so the prompt is an offer rather than a
 * correction after the fact.
 *
 * orgQuery: staff log production, so staff must be able to see this. It
 * carries quantities and names, no money.
 */
export const subRecipeCheck = orgQuery({
  args: { menuItemId: v.id("menuItems"), batchCount: v.number() },
  handler: async (ctx, { menuItemId, batchCount }) => {
    const item = await ctx.db.get(menuItemId);
    if (!item || item.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    if (!Number.isFinite(batchCount) || batchCount <= 0) return [];

    const recipeLines = await ctx.db
      .query("recipeLines")
      .withIndex("by_org_menuItem", (q) =>
        q.eq("orgId", ctx.orgId).eq("menuItemId", menuItemId),
      )
      .collect();

    const now = Date.now();
    const lines: SubRecipeLine[] = [];
    for (const line of recipeLines) {
      if (line.componentType !== "menuItem") continue;
      const subId = line.componentId as Id<"menuItems">;
      const sub = await ctx.db.get(subId);
      if (!sub || sub.orgId !== ctx.orgId) continue;
      const logs = await ctx.db
        .query("productionLogs")
        .withIndex("by_org_menuItem", (q) =>
          q.eq("orgId", ctx.orgId).eq("menuItemId", subId),
        )
        .collect();
      lines.push({
        subMenuItemId: subId,
        name: sub.name,
        qtyMilliPerBatch: line.qtyMilli,
        // Only what is LIVE. Expired buttercream is not stock she can use,
        // and counting it would make the prompt fail to appear exactly when
        // she most needs it.
        onHandMilli: logs
          .filter((l) => isLive(l, now))
          .reduce((sum, l) => sum + l.overhangRemainingQtyMilli, 0),
        baseBatchYield: sub.baseBatchYield,
      });
    }
    return subRecipeShortfalls(lines, batchCount);
  },
});

/** The form's prefill: what is booked and not yet made. */
export const whatNeedsMaking = orgQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_org_orderDate", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const open = orders.filter(
      (o) => o.status === "confirmed" && o.deliveryDate >= today,
    );

    const allLines = await ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const byOrder = new Map<string, Doc<"orderLines">[]>();
    for (const line of allLines) {
      const bucket = byOrder.get(line.orderId);
      if (bucket) bucket.push(line);
      else byOrder.set(line.orderId, [line]);
    }

    const customers = new Map<string, string>();
    const wanted = new Map<
      string,
      {
        qtyMilli: number;
        /** Per order, because she ticks orders one at a time and the overhang
         * has to answer for the ones she actually ticked. */
        orders: {
          id: Id<"orders">;
          who: string;
          deliveryDate: string;
          qtyMilli: number;
        }[];
      }
    >();

    for (const order of open) {
      let who = "Walk-in";
      if (order.customerId) {
        if (!customers.has(order.customerId)) {
          const c = await ctx.db.get(order.customerId);
          customers.set(order.customerId, c?.name ?? "(removed)");
        }
        who = customers.get(order.customerId)!;
      }
      for (const line of byOrder.get(order._id) ?? []) {
        // Already coming off the shelf — it needs no baking.
        if (!line.menuItemId || line.fulfilledFromProductionLogId) continue;
        const entry = wanted.get(line.menuItemId) ?? { qtyMilli: 0, orders: [] };
        entry.qtyMilli += line.qtyMilli;
        // One order can carry two lines of the same item (a split fulfilment,
        // or simply the same thing added twice), so accumulate onto the
        // existing row rather than pushing a duplicate.
        const already = entry.orders.find((o) => o.id === order._id);
        if (already) already.qtyMilli += line.qtyMilli;
        else {
          entry.orders.push({
            id: order._id,
            who,
            deliveryDate: order.deliveryDate,
            qtyMilli: line.qtyMilli,
          });
        }
        wanted.set(line.menuItemId, entry);
      }
    }

    const rows = [];
    for (const [menuItemId, entry] of wanted) {
      const item = await ctx.db.get(menuItemId as Id<"menuItems">);
      if (!item) continue;
      const perBatch = item.baseBatchYield > 0 ? item.baseBatchYield : 1;
      rows.push({
        menuItemId: item._id,
        name: item.name,
        baseBatchYield: item.baseBatchYield,
        shelfLifeHours: item.shelfLifeHours ?? null,
        neededMilli: entry.qtyMilli,
        /** The smallest whole number of batches that covers the orders. */
        suggestedBatchCount: Math.max(
          1,
          Math.ceil(entry.qtyMilli / 1000 / perBatch),
        ),
        orders: entry.orders.sort((a, b) =>
          a.deliveryDate.localeCompare(b.deliveryDate),
        ),
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * What is on the shelf right now, and what has quietly gone off.
 *
 * orgQuery, because selling the overhang down is staff work and they cannot
 * do it without knowing what is there. The VALUE of it is hers alone, so it
 * arrives as null for staff rather than being hidden by the screen — gating
 * happens here, never in CSS (CONTEXT.md — Access).
 */
export const stockOnHand = orgQuery({
  args: {},
  handler: async (ctx) => {
    const logs = await ctx.db
      .query("productionLogs")
      .withIndex("by_org_producedAt", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const now = Date.now();
    const names = new Map<string, string>();

    const rows = [];
    for (const log of logs) {
      if (log.overhangRemainingQtyMilli <= 0) continue;
      if (!names.has(log.menuItemId)) {
        const item = await ctx.db.get(log.menuItemId);
        names.set(log.menuItemId, item?.name ?? "(removed)");
      }
      const live = isLive(log, now);
      rows.push({
        productionLogId: log._id,
        menuItemId: log.menuItemId,
        name: names.get(log.menuItemId)!,
        qtyMilli: log.overhangRemainingQtyMilli,
        producedOn: log.producedOn,
        expiresAt: log.overhangExpiresAt ?? null,
        live,
        /** Costed against ITS OWN batch, at the price stamped when it was
         * made — not at what those ingredients cost today. Owner only. */
        valueCents:
          ctx.role === "owner"
            ? Math.round(
                (snapshotTotalCents(log.cogsSnapshot) *
                  log.overhangRemainingQtyMilli) /
                  1000,
              )
            : null,
      });
    }
    return {
      live: rows.filter((r) => r.live),
      expired: rows.filter((r) => !r.live),
    };
  },
});

/**
 * Made versus sold, per item, over a period. The leak, in numbers.
 *
 * `sold` counts what left as a sale — what the linked orders consumed plus
 * anything sold down off the shelf. `wasted` is bench waste plus overhang
 * that expired without being sold. The gap between made and sold is the
 * thing no other screen in Sous can see.
 *
 * ownerQuery: this is the cost view, and every figure on it is money. Staff
 * log production and sell the overhang down; what any of it cost is hers.
 * Gating happens here rather than by owner-gating the route, because a query
 * anyone can call is reachable whatever the screen does (CONTEXT.md — Access).
 */
export const madeVersusSold = ownerQuery({
  args: {
    /** Inclusive "YYYY-MM-DD" bounds, her local days. */
    start: v.optional(v.string()),
    end: v.string(),
  },
  handler: async (ctx, { start, end }) => {
    const logs = await ctx.db
      .query("productionLogs")
      .withIndex("by_org_producedAt", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const inPeriod = logs.filter(
      (l) => l.producedOn <= end && (start === undefined || l.producedOn >= start),
    );

    const now = Date.now();
    const names = new Map<string, string>();
    const byItem = new Map<
      string,
      {
        madeMilli: number;
        expectedMilli: number;
        soldMilli: number;
        wastedMilli: number;
        onHandMilli: number;
        batches: number;
        wasteValueCents: number;
      }
    >();

    for (const log of inPeriod) {
      if (!names.has(log.menuItemId)) {
        const item = await ctx.db.get(log.menuItemId);
        names.set(log.menuItemId, item?.name ?? "(removed)");
      }
      const entry =
        byItem.get(log.menuItemId) ?? {
          madeMilli: 0,
          expectedMilli: 0,
          soldMilli: 0,
          wastedMilli: 0,
          onHandMilli: 0,
          batches: 0,
          wasteValueCents: 0,
        };

      const live = isLive(log, now);
      // Expired overhang is waste — derived, never written. What has not
      // expired is still on the shelf and has not yet chosen an exit.
      const expiredMilli = live ? 0 : log.overhangRemainingQtyMilli;
      const onHandMilli = live ? log.overhangRemainingQtyMilli : 0;
      const wasted = log.wasteQtyMilli + expiredMilli;

      entry.madeMilli += log.actualYieldMilli;
      entry.expectedMilli += log.expectedYieldMilli;
      // The partition: made = sold + wasted + still on hand.
      entry.soldMilli += Math.max(
        0,
        log.actualYieldMilli - wasted - onHandMilli,
      );
      entry.wastedMilli += wasted;
      entry.onHandMilli += onHandMilli;
      entry.batches += 1;
      entry.wasteValueCents += Math.round(
        (snapshotTotalCents(log.cogsSnapshot) * wasted) / 1000,
      );
      byItem.set(log.menuItemId, entry);
    }

    const rows = [...byItem.entries()]
      .map(([menuItemId, e]) => ({
        menuItemId: menuItemId as Id<"menuItems">,
        name: names.get(menuItemId)!,
        ...e,
        wastePercent:
          e.madeMilli > 0 ? Math.round((e.wastedMilli * 100) / e.madeMilli) : 0,
      }))
      .sort((a, b) => b.wastedMilli - a.wastedMilli);

    return {
      rows,
      /** Per batch, oldest first — the variance and waste-rate series. */
      batches: inPeriod
        .map((l) => ({
          id: l._id,
          menuItemId: l.menuItemId,
          name: names.get(l.menuItemId) ?? "",
          producedOn: l.producedOn,
          expectedMilli: l.expectedYieldMilli,
          actualMilli: l.actualYieldMilli,
          /** THIS batch's waste, bench plus anything of it that expired.
           * Sent per batch rather than left to the client to reconstruct
           * from the item's period-wide rate: that reconstruction gives
           * every day of an item the same rate, so the "over time" chart
           * would move only when the item mix moved. */
          wastedMilli:
            l.wasteQtyMilli + (isLive(l, now) ? 0 : l.overhangRemainingQtyMilli),
          /** Negative means the batch under-delivered. */
          variancePercent:
            l.expectedYieldMilli > 0
              ? Math.round(
                  ((l.actualYieldMilli - l.expectedYieldMilli) * 100) /
                    l.expectedYieldMilli,
                )
              : 0,
        }))
        .sort((a, b) => a.producedOn.localeCompare(b.producedOn)),
    };
  },
});
