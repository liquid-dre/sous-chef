import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  orgMutation,
  orgQuery,
  ownerQuery,
  publicMutation,
  orgIsWritable,
  publicQuery,
} from "./lib/functions";
import { sensoryAxis, feedbackFlag } from "./schema";
import {
  summarise,
  warningsFor,
  type FeedbackRow,
  type SensoryAxis,
} from "./lib/feedback";

/**
 * Feedback: what the customer actually said.
 *
 * Two capture paths, hers first. `log` is her one tap on the order list —
 * CONTEXT.md is explicit that a realistic survey response is 10–30% and her own
 * notes will outnumber it five to one, so that path is primary and everything
 * about it is built to be fast and to accept half an answer. `submit` is the
 * public form, and it is the second unauthenticated write in Sous.
 *
 * The aggregation lives in convex/lib/feedback.ts, pure and unit-tested. This
 * file only reads and writes.
 */

/** Long enough for a real comment, short enough that an anonymous caller
 * cannot use the field as storage. */
const MAX_FREE_TEXT = 500;

const ratingValidator = v.array(
  v.object({ axis: sensoryAxis, value: v.number() }),
);

/** Integer, in range. A tampered 7 would draw off the chart; a 1.5 would put a
 * rating in a bucket that does not exist. */
function cleanRatings(
  ratings: { axis: SensoryAxis; value: number }[],
  allowed: SensoryAxis[],
): { axis: SensoryAxis; value: number }[] {
  const seen = new Set<string>();
  const out: { axis: SensoryAxis; value: number }[] = [];
  for (const rating of ratings) {
    if (!allowed.includes(rating.axis)) {
      throw new Error("That isn't one of this item's axes.");
    }
    if (!Number.isInteger(rating.value) || rating.value < -2 || rating.value > 2) {
      throw new Error("A rating has to be between −2 and +2.");
    }
    // One value per axis. Two would double-count one person's opinion.
    if (seen.has(rating.axis)) continue;
    seen.add(rating.axis);
    out.push({ axis: rating.axis, value: rating.value });
  }
  return out;
}

function cleanText(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_FREE_TEXT);
}

/** The item's declared axes, or a throw if the item is not this org's. */
async function axesFor(
  ctx: { db: { get: (id: Id<"menuItems">) => Promise<Doc<"menuItems"> | null> } },
  orgId: string,
  menuItemId: Id<"menuItems">,
): Promise<SensoryAxis[]> {
  const item = await ctx.db.get(menuItemId);
  if (!item || item.orgId !== orgId) {
    throw new ConvexError({ code: "NOT_FOUND" as const });
  }
  return item.sensoryAxes;
}

// --- Her path ---------------------------------------------------------------

/**
 * One tap on the order list, and she writes down what the customer said.
 *
 * `orgMutation`, not `ownerMutation`: staff do "orders, production, feedback"
 * (CONTEXT.md — Access). Feedback carries no cost and no margin, so there is
 * nothing here for the owner-only boundary to protect.
 *
 * Everything is optional. She is recording a half-remembered comment on a
 * phone in a kitchen, not filling in a survey — a mutation that refused a note
 * with no rating would mean the note never gets logged at all.
 */
export const log = orgMutation({
  args: {
    orderId: v.id("orders"),
    /** Absent for an order-level note: a flag or a comment about the whole
     * order rather than about one thing on it. */
    menuItemId: v.optional(v.id("menuItems")),
    axisRatings: v.optional(ratingValidator),
    flags: v.optional(v.array(feedbackFlag)),
    freeText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || order.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }

    const ratings = args.menuItemId
      ? cleanRatings(
          args.axisRatings ?? [],
          await axesFor(ctx, ctx.orgId, args.menuItemId),
        )
      : [];
    const flags = args.flags ?? [];
    const freeText = cleanText(args.freeText);

    // An entirely empty entry is not a record of anything, and saving one
    // would put a row in the denominator that nobody spoke into.
    if (ratings.length === 0 && flags.length === 0 && !freeText) {
      throw new Error("Nothing to save yet — tap a rating, a chip, or write a line.");
    }

    const feedbackId = await ctx.db.insert("feedback", {
      orgId: ctx.orgId,
      orderId: args.orderId,
      menuItemId: args.menuItemId,
      source: "chef",
      axisRatings: ratings,
      flags,
      freeText,
      receivedAt: Date.now(),
    });
    return { feedbackId };
  },
});

/** Undo. Her own notes only — a customer's submission is theirs, and she does
 * not get to edit what somebody said about her food. */
export const remove = orgMutation({
  args: { feedbackId: v.id("feedback") },
  handler: async (ctx, { feedbackId }) => {
    const row = await ctx.db.get(feedbackId);
    if (!row || row.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    if (row.source !== "chef") {
      throw new Error("That came from a customer — it stays as they left it.");
    }
    await ctx.db.delete(feedbackId);
    return null;
  },
});

// --- Reading ----------------------------------------------------------------

/** Everything said about one order, for the order detail. `orgQuery`: staff
 * capture feedback, so staff can see what has already been captured. */
export const forOrder = orgQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order || order.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", orderId),
      )
      .collect();

    const names = new Map<string, string>();
    for (const row of rows) {
      if (row.menuItemId && !names.has(row.menuItemId)) {
        const item = await ctx.db.get(row.menuItemId);
        names.set(row.menuItemId, item?.name ?? "(removed)");
      }
    }

    return {
      /** Nothing is sent from Sous; she shares this herself. */
      feedbackToken: order.feedbackToken,
      /** The public form has been used. Shown so she knows not to wait. */
      customerReplied: rows.some((r) => r.source === "customer"),
      entries: rows
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .map((row) => ({
          id: row._id,
          menuItemId: row.menuItemId ?? null,
          itemName: row.menuItemId ? (names.get(row.menuItemId) ?? "(removed)") : null,
          source: row.source,
          axisRatings: row.axisRatings,
          flags: row.flags,
          freeText: row.freeText ?? null,
          receivedAt: row.receivedAt,
        })),
    };
  },
});

/**
 * The sensory profile for one menu item.
 *
 * `ownerQuery` because it lives on the menu-item page, which is owner-only at
 * the route AND at `menuItems.getForBuilder`. Staff log feedback; they do not
 * read the analysis of it.
 */
export const forMenuItem = ownerQuery({
  args: { menuItemId: v.id("menuItems") },
  handler: async (ctx, { menuItemId }) => {
    const item = await ctx.db.get(menuItemId);
    if (!item || item.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_org_menuItem", (q) =>
        q.eq("orgId", ctx.orgId).eq("menuItemId", menuItemId),
      )
      .collect();

    const summary = summarise(item.sensoryAxes, rows as FeedbackRow[]);
    return {
      name: item.name,
      axes: item.sensoryAxes,
      summary,
      warnings: warningsFor(summary),
      comments: rows
        .filter((r) => r.freeText)
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .slice(0, 10)
        .map((r) => ({
          id: r._id,
          text: r.freeText!,
          source: r.source,
          receivedAt: r.receivedAt,
        })),
    };
  },
});

// --- The public form --------------------------------------------------------

/**
 * What the form needs, for a token and nothing else.
 *
 * `publicQuery` is a bare alias of raw `query` — it resolves no org, checks no
 * role and validates no token. Every guard below is load-bearing, and the
 * payload is assembled field by field rather than spread from a document, so a
 * future column on `orders` or `menuItems` cannot leak by default. There is no
 * price, no cost, no margin and no customer phone number anywhere in it.
 */
export const byToken = publicQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    // Cheap shape check first: an invoice token pasted into the feedback route
    // should fail here rather than after an index scan.
    if (!token.startsWith("f_")) return null;

    const order = await ctx.db
      .query("orders")
      .withIndex("by_feedbackToken", (q) => q.eq("feedbackToken", token))
      .unique();
    if (!order) return null;
    // Asking somebody how a cancelled order was is not a question worth
    // asking, and reads as the kitchen not knowing its own business.
    if (order.status === "cancelled") return null;

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_orgId", (q) => q.eq("orgId", order.orgId))
      .unique();
    if (!org) return null;

    const lines = await ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", order.orgId).eq("orderId", order._id),
      )
      .collect();

    // One entry per distinct menu item, in the order they appear on the order.
    // Only items with axes: the form grows only where she has done the work to
    // make an answer mean something.
    const seen = new Set<string>();
    const items: { menuItemId: string; name: string; axes: SensoryAxis[] }[] = [];
    for (const line of lines) {
      if (!line.menuItemId || seen.has(line.menuItemId)) continue;
      seen.add(line.menuItemId);
      const item = await ctx.db.get(line.menuItemId);
      if (!item || item.sensoryAxes.length === 0) continue;
      items.push({
        menuItemId: item._id,
        name: item.name,
        axes: item.sensoryAxes,
      });
    }

    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", order.orgId).eq("orderId", order._id),
      )
      .collect();

    return {
      /** Her branding, so the page reads as coming from her kitchen. */
      org: {
        name: org.name,
        logoUrl: org.logo ? await ctx.storage.getUrl(org.logo) : null,
      },
      palette: org.palette,
      /** First name only. "How was it, Tariro?" needs no surname and no phone
       * number, and a public URL is not a place to put either. */
      customerFirstName: order.customerId
        ? ((await ctx.db.get(order.customerId))?.name.trim().split(/\s+/)[0] ?? null)
        : null,
      deliveryDate: order.deliveryDate,
      items,
      /** Already answered. The page shows the thank-you, not a fresh form. */
      alreadySent: existing.some((r) => r.source === "customer"),
    };
  },
});

/**
 * The customer's answer. The SECOND unauthenticated write in Sous, and a much
 * larger surface than the first.
 *
 * `invoices.recordView` takes only a token and writes a timestamp; this takes
 * caller-supplied ratings, flags and words. So every input is checked against
 * the order itself rather than trusted:
 *
 * - the menu item must be a line on THAT order;
 * - each axis must be one the item declares;
 * - each value must be an integer in −2..+2;
 * - free text is trimmed and capped;
 * - and the whole thing writes AT MOST ONCE per order, ever, so a link that
 *   gets forwarded or shared cannot flood one item's profile. There is no
 *   login, no email and no rate limit standing behind that guarantee — the
 *   single-row rule IS the guarantee.
 *
 * Unlike `recordView` it returns a result rather than an unconditional null,
 * because `byToken` already reveals to anyone who loads the page whether a
 * token resolves, and the scope requires the customer to be told it worked.
 */
export const submit = publicMutation({
  args: {
    token: v.string(),
    perItem: v.array(
      v.object({ menuItemId: v.id("menuItems"), axisRatings: ratingValidator }),
    ),
    flags: v.array(feedbackFlag),
    freeText: v.optional(v.string()),
  },
  handler: async (ctx, { token, perItem, flags, freeText }) => {
    if (!token.startsWith("f_")) return { ok: false as const, reason: "unknown" as const };

    const order = await ctx.db
      .query("orders")
      .withIndex("by_feedbackToken", (q) => q.eq("feedbackToken", token))
      .unique();
    if (!order || order.status === "cancelled") {
      return { ok: false as const, reason: "unknown" as const };
    }

    // A disabled kitchen is read-only, and that has to be true here too:
    // `publicMutation` is a bare alias of the raw builder, so this handler
    // never passes through the `assertWritable` every other write in Sous
    // funnels through. Deliberately the SAME "unknown" a mistyped token gets
    // — her customer should not learn from a feedback form that Sous has
    // disabled her account.
    if (!(await orgIsWritable(ctx, order.orgId))) {
      return { ok: false as const, reason: "unknown" as const };
    }

    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", order.orgId).eq("orderId", order._id),
      )
      .collect();
    if (existing.some((r) => r.source === "customer")) {
      return { ok: false as const, reason: "alreadySent" as const };
    }

    // Which menu items are actually on this order. A caller naming any other
    // item is writing into a profile they were never invited to rate.
    const lines = await ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", order.orgId).eq("orderId", order._id),
      )
      .collect();
    const onOrder = new Set(lines.map((l) => l.menuItemId).filter(Boolean) as string[]);

    const cleaned: { menuItemId: Id<"menuItems">; ratings: { axis: SensoryAxis; value: number }[] }[] = [];
    for (const entry of perItem) {
      if (!onOrder.has(entry.menuItemId)) {
        return { ok: false as const, reason: "unknown" as const };
      }
      const item = await ctx.db.get(entry.menuItemId);
      if (!item || item.orgId !== order.orgId) {
        return { ok: false as const, reason: "unknown" as const };
      }
      let ratings;
      try {
        ratings = cleanRatings(entry.axisRatings, item.sensoryAxes);
      } catch {
        // A tampered payload is not something to explain to the person who
        // sent it; it gets the same answer a bad token gets.
        return { ok: false as const, reason: "unknown" as const };
      }
      if (ratings.length > 0) cleaned.push({ menuItemId: entry.menuItemId, ratings });
    }

    const text = cleanText(freeText);
    if (cleaned.length === 0 && flags.length === 0 && !text) {
      return { ok: false as const, reason: "empty" as const };
    }

    const receivedAt = Date.now();
    // Flags and words belong to the ORDER and are written once; ratings belong
    // to their item. This is the shape the schema's optional menuItemId was
    // designed for.
    if (flags.length > 0 || text) {
      await ctx.db.insert("feedback", {
        orgId: order.orgId,
        orderId: order._id,
        source: "customer",
        axisRatings: [],
        flags,
        freeText: text,
        receivedAt,
      });
    }
    for (const entry of cleaned) {
      await ctx.db.insert("feedback", {
        orgId: order.orgId,
        orderId: order._id,
        menuItemId: entry.menuItemId,
        source: "customer",
        axisRatings: entry.ratings,
        flags: [],
        receivedAt,
      });
    }

    return { ok: true as const };
  },
});
