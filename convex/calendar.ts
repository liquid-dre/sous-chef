import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { orgQuery, ownerQuery, type OrgCtx, type QueryCtx } from "./lib/functions";
import {
  DEFAULT_CAPACITY_HOURS,
  consolidate,
  hoursByDay,
  overCapacity,
  shiftDay,
  weekdayOf,
  type Demand,
  type Prompt,
} from "./lib/schedule";
import { stocktakeDueOn } from "./lib/stock";

/**
 * The calendar — and it is the screen STAFF LIVE ON.
 *
 * `app/[orgSlug]/(app)/page.tsx:28` redirects staff here on sign-in, and it
 * has been a `StubPage` since the shell was built. Everything about the shape
 * of this file follows from that: it is an `orgQuery`, its payload is built
 * for the smaller role first, and the owner's extra material is ADDED rather
 * than the staff's being subtracted.
 *
 * That direction matters. DESIGN.md's NEVER SHIP list includes "costs or
 * margins reachable by a staff-role user", and the two existing role-gated
 * payloads in the codebase (`orders.get:513`, `production.stockOnHand:714`)
 * both null a field out. Nulling is fine when the KEY is harmless — but this
 * slice's acceptance criterion is stricter: no cost or price field *present*
 * in the staff payload. `valueCents: null` is a field present. So the owner
 * keys are omitted entirely, and convex/calendar.test.ts asserts on the key
 * set rather than on the values.
 *
 * Reads orders through `by_org_deliveryDate` — the index added with the
 * comment "calendar; revenue recognition" and never once used until now.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function assertDay(day: string) {
  if (!DAY.test(day)) throw new Error("Dates need to look like 2026-08-04.");
}

// --- Loading the window ---------------------------------------------------

interface Loaded {
  orders: Doc<"orders">[];
  linesByOrder: Map<string, Doc<"orderLines">[]>;
  items: Map<string, Doc<"menuItems">>;
  who: Map<string, string>;
}

/**
 * Everything in the window, read once.
 *
 * The order read is bounded on BOTH ends by the index, unlike
 * `production.whatNeedsMaking:589` which collects the whole org and filters in
 * memory. A calendar is paged through, so an unbounded read would grow with
 * her history on every single tap.
 */
async function load(
  ctx: QueryCtx & OrgCtx,
  start: string,
  end: string,
): Promise<Loaded> {
  const orders = (
    await ctx.db
      .query("orders")
      .withIndex("by_org_deliveryDate", (q) =>
        q.eq("orgId", ctx.orgId).gte("deliveryDate", start).lte("deliveryDate", end),
      )
      .collect()
  ).filter((o) => o.status !== "cancelled");

  const linesByOrder = new Map<string, Doc<"orderLines">[]>();
  const items = new Map<string, Doc<"menuItems">>();
  const who = new Map<string, string>();
  if (orders.length === 0) return { orders, linesByOrder, items, who };

  const ids = new Set<string>(orders.map((o) => o._id));
  const allLines = await ctx.db
    .query("orderLines")
    .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  for (const line of allLines) {
    if (!ids.has(line.orderId)) continue;
    const bucket = linesByOrder.get(line.orderId);
    if (bucket) bucket.push(line);
    else linesByOrder.set(line.orderId, [line]);
    if (line.menuItemId && !items.has(line.menuItemId)) {
      const item = await ctx.db.get(line.menuItemId);
      if (item) items.set(line.menuItemId, item);
    }
  }

  for (const order of orders) {
    if (!order.customerId) continue;
    if (who.has(order.customerId)) continue;
    const c = await ctx.db.get(order.customerId);
    who.set(order.customerId, c?.name ?? "(removed)");
  }
  return { orders, linesByOrder, items, who };
}

/** Order lines still needing a bake, as the scheduler wants them. */
function demandsFrom(loaded: Loaded): Demand[] {
  const out: Demand[] = [];
  for (const order of loaded.orders) {
    // Delivered orders have already happened; only what is still owed can
    // need making.
    if (order.status !== "confirmed") continue;
    const name = order.customerId
      ? (loaded.who.get(order.customerId) ?? "Walk-in")
      : "Walk-in";
    for (const line of loaded.linesByOrder.get(order._id) ?? []) {
      // Off-menu lines have no recipe to schedule. A line already coming off
      // a batch that exists needs no second one — the same guard
      // whatNeedsMaking:633 applies.
      if (!line.menuItemId || line.fulfilledFromProductionLogId) continue;
      const item = loaded.items.get(line.menuItemId);
      if (!item) continue;
      out.push({
        orderId: order._id,
        who: name,
        deliveryDay: order.deliveryDate,
        menuItemId: item._id,
        itemName: item.name,
        qtyMilli: line.qtyMilli,
        baseBatchYield: item.baseBatchYield,
        leadTimeHours: item.leadTimeHours ?? null,
        batchProductionMinutes: item.batchProductionMinutes,
        shelfLifeHours: item.shelfLifeHours ?? null,
      });
    }
  }
  return out;
}

// --- The payload ----------------------------------------------------------

export interface DueEntry {
  orderId: Id<"orders">;
  who: string;
  deliveryDay: string;
  /** What is on it, in her words. Quantities and names only — no prices; the
   * order screen is where money lives. */
  summary: string;
  status: Doc<"orders">["status"];
}

export const range = orgQuery({
  args: { start: v.string(), end: v.string(), today: v.string() },
  handler: async (ctx, { start, end, today }) => {
    assertDay(start);
    assertDay(end);
    assertDay(today);
    if (end < start) throw new Error("That range runs backwards.");

    const loaded = await load(ctx, start, end);
    const prompts = consolidate(demandsFrom(loaded));

    const due: DueEntry[] = loaded.orders.map((order) => {
      const lines = loaded.linesByOrder.get(order._id) ?? [];
      const parts = lines.map((line) => {
        const units = Math.round(line.qtyMilli / 1000);
        const name = line.menuItemId
          ? (loaded.items.get(line.menuItemId)?.name ?? "(removed)")
          : (line.description ?? "Something off-menu");
        return `${units} × ${name}`;
      });
      return {
        orderId: order._id,
        who: order.customerId
          ? (loaded.who.get(order.customerId) ?? "Walk-in")
          : "Walk-in",
        deliveryDay: order.deliveryDate,
        summary: parts.join(", ") || "Nothing on it yet",
        status: order.status,
      };
    });

    // Prompts that start BEFORE the window still belong to it — a batch she
    // should have started last Sunday for a Wednesday delivery must not
    // vanish because she paged forward. They are clamped onto the first
    // visible day and carry `overdue` so the card can say so.
    const visiblePrompts = prompts
      .filter((p) => p.startDay <= end)
      .map((p) => ({
        ...p,
        overdue: p.startDay < today,
        startDay: p.startDay < start ? start : p.startDay,
      }));

    const hours = hoursByDay(visiblePrompts as Prompt[]);
    const stocktakeDay = ctx.org?.stocktakeDay ?? null;

    // Stocktake day is INFORMATIONAL for staff — recordStocktake is an
    // ownerMutation, so they cannot act on it. It renders without a button
    // and the copy says whose job it is, rather than being hidden: in a
    // two-person kitchen the counting itself may well be delegated even
    // though recording it is hers.
    const stocktakeDays: string[] = [];
    for (let day = start; day <= end; day = shiftDay(day, 1)) {
      if (stocktakeDueOn(day, stocktakeDay)) stocktakeDays.push(day);
    }

    const owner = ctx.role === "owner";
    const ceiling = ctx.org?.productionHoursPerDay ?? DEFAULT_CAPACITY_HOURS;

    return {
      start,
      end,
      today,
      due,
      prompts: visiblePrompts,
      stocktakeDays,
      /**
       * OWNER ONLY, and the key is absent rather than null for staff — the
       * acceptance criterion is about what is present in the payload, and a
       * null is present. Capacity is her judgement about her own day, and
       * "what to buy" is owner-only by construction (purchases.createBatch
       * and every pantry runway query are owner-gated).
       */
      ...(owner
        ? {
            capacity: {
              ceilingHours: ceiling,
              byDay: [...hours.entries()]
                .map(([day, h]) => ({
                  day,
                  hours: Math.round(h * 10) / 10,
                  over: overCapacity(h, ceiling),
                }))
                .sort((a, b) => a.day.localeCompare(b.day)),
            },
          }
        : {}),
    };
  },
});

// --- The charts, owner only ----------------------------------------------

/**
 * Order density by weekday and week — her rhythm.
 *
 * `ownerQuery`, and not because it carries money: it carries none. It is
 * ANALYSIS. CONTEXT.md (Access) keeps staff off the dashboard, and this
 * answers the same class of question — which day to schedule production, and
 * which day the recurring "taking orders" message should go out. Keeping it
 * owner-only also leaves the staff payload with nothing to strip.
 */
export const density = ownerQuery({
  args: { end: v.string(), weeks: v.optional(v.number()) },
  handler: async (ctx, { end, weeks }) => {
    assertDay(end);
    const span = Math.max(1, Math.min(52, weeks ?? 12));
    // Back to the Monday of the earliest week, so every column is a whole one.
    const back = (weekdayOf(end) + 6) % 7;
    const lastMonday = shiftDay(end, -back);
    const start = shiftDay(lastMonday, -(span - 1) * 7);

    const orders = (
      await ctx.db
        .query("orders")
        .withIndex("by_org_deliveryDate", (q) =>
          q.eq("orgId", ctx.orgId).gte("deliveryDate", start).lte("deliveryDate", end),
        )
        .collect()
    ).filter((o) => o.status !== "cancelled");

    const counts = new Map<string, number>();
    for (const order of orders) {
      counts.set(order.deliveryDate, (counts.get(order.deliveryDate) ?? 0) + 1);
    }

    // One column per week, seven bins per column — the shape HeatmapChart
    // wants (components/charts/heatmap/heatmap-context.tsx:31-40).
    const columns = Array.from({ length: span }, (_, w) => {
      const monday = shiftDay(start, w * 7);
      return {
        bin: w,
        bins: Array.from({ length: 7 }, (_, d) => {
          const day = shiftDay(monday, d);
          return { bin: d, day, count: counts.get(day) ?? 0 };
        }),
      };
    });

    return {
      start,
      end,
      columns,
      /** n = , stated wherever a claim depends on it (DESIGN.md §5). */
      orderCount: orders.length,
    };
  },
});
