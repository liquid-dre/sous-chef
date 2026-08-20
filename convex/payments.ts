import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  orgMutation,
  type MutationCtx,
  type OrgCtx,
  type QueryCtx,
} from "./lib/functions";
import { computeInvoiceTotals, mergeLines } from "../lib/invoice-totals";

/**
 * Payments. A table, not a state.
 *
 * An order has many payments and its status — Unpaid, Part-paid, Paid — is
 * the sum of them against the total, computed at read time and stored
 * nowhere. That is not a stylistic preference. Two $40 payments arriving at
 * once are two INSERTS, which Convex serialises, and the sum is $80 under
 * either ordering. A stored `paidCents` would be a read-modify-write: both
 * writers read 0, both write 40, and the order sits at $40 forever with $80
 * in the till. There is no lost update here because nobody performs an
 * update.
 *
 * That is also why `paidCents` must never be denormalised onto `orders`, no
 * matter how tempting it looks when the receivables list gets slow.
 */

/**
 * How long a mis-tap stays undoable by the person who made it.
 *
 * Measured against `_creationTime`, never `paidAt`. They are different facts:
 * `paidAt` is a domain claim she is allowed to back-date ("Tariro paid last
 * Tuesday"), while `_creationTime` is the server's record of when the tap
 * happened. Using `paidAt` would make a back-dated payment instantly
 * un-undoable and give a mis-dated one an eight-day window.
 */
export const UNDO_WINDOW_MS = 15 * 60 * 1000;

/** A day either side would be a broken clock, not a late entry. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export interface PaymentState {
  totalCents: number;
  paidCents: number;
  /** Never negative — see excessCents. */
  balanceCents: number;
  /** Paid beyond the total. Its own fact, never a fourth status. */
  excessCents: number;
  status: "unpaid" | "partPaid" | "paid";
}

/**
 * The order's money, derived from its lines and its payments.
 *
 * Note the order of the status ladder: "covered" is tested FIRST. Testing
 * `paid <= 0` first reads a zero-total order as unpaid forever, and a quick
 * sale of a free item is exactly that order.
 */
export async function paymentStateFor(
  ctx: (QueryCtx | MutationCtx) & OrgCtx,
  order: Doc<"orders">,
): Promise<PaymentState> {
  const [lines, payments] = await Promise.all([
    ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", order._id),
      )
      .collect(),
    ctx.db
      .query("payments")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", order._id),
      )
      .collect(),
  ]);
  const totals = totalsFor(order, lines);
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  return derive(totals.totalCents, paidCents);
}

/** Totals from the order's own stamped tax, never the live org settings. */
export function totalsFor(order: Doc<"orders">, lines: Doc<"orderLines">[]) {
  return computeInvoiceTotals({
    // MERGED first, exactly as the invoice prints them. Totalling the raw rows
    // rounds a split line twice — 3 and 2 units at $12.50 give $62.51 apart
    // and $62.50 together — so the document would ask for one figure while
    // this ledger waited for another, and a customer who paid the printed
    // amount would read as a cent short forever.
    lines: mergeLines(lines).map((l) => ({
      description: "",
      qtyMilli: l.qtyMilli,
      unitPriceCents: l.unitPriceCents,
    })),
    deliveryFeeCents: order.deliveryFeeCents,
    discountCents: order.discountCents,
    tax: {
      enabled: order.taxRateBpAtCreation > 0,
      rateBp: order.taxRateBpAtCreation,
      inclusive: order.taxInclusiveAtCreation,
    },
    depositPercent: order.depositPercent ?? null,
  });
}

export function derive(totalCents: number, paidCents: number): PaymentState {
  return {
    totalCents,
    paidCents,
    // Clamped. An unclamped negative balance would net off against other
    // customers' debts in the "owed to you" total, so one person overpaying
    // by $20 would silently erase $20 someone else still owes.
    balanceCents: Math.max(0, totalCents - paidCents),
    excessCents: Math.max(0, paidCents - totalCents),
    status:
      paidCents >= totalCents
        ? ("paid" as const)
        : paidCents <= 0
          ? ("unpaid" as const)
          : ("partPaid" as const),
  };
}

/** May this caller undo this payment? Computed server-side so the UI never
 * offers a button the server will refuse. */
export function canRemovePayment(
  payment: Doc<"payments">,
  ctx: OrgCtx,
  now: number,
): boolean {
  if (ctx.role === "owner") return true;
  return (
    payment.recordedBy === ctx.userId &&
    now - payment._creationTime <= UNDO_WINDOW_MS
  );
}

/**
 * The one place a payment row is written, so the quick sale cannot drift
 * from the deliberate path.
 */
export async function insertPaymentRow(
  ctx: MutationCtx & OrgCtx,
  args: {
    orderId: Id<"orders">;
    amountCents: number;
    paidAt?: number;
    method?: string;
    note?: string;
  },
): Promise<Id<"payments">> {
  return await ctx.db.insert("payments", {
    orgId: ctx.orgId,
    orderId: args.orderId,
    amountCents: args.amountCents,
    paidAt: args.paidAt ?? Date.now(),
    method: args.method?.trim() || undefined,
    note: args.note?.trim() || undefined,
    recordedBy: ctx.userId,
  });
}

/**
 * Record money that arrived.
 *
 * orgMutation, not owner-only. The owner boundary in this app is drawn
 * around COSTS — staff already see the total, the discount and the whole
 * invoice, so "$40 arrived" against a figure they can read leaks nothing.
 * The decisive argument is operational: staff take cash at the door, and a
 * payment they cannot log is a payment that goes unlogged, which is the
 * exact failure this slice exists to prevent. Restricting it would not stop
 * fraud either — the easier dishonest move is to not record at all. What
 * fraud needs is attribution, and that is `recordedBy`.
 */
export const record = orgMutation({
  args: {
    orderId: v.id("orders"),
    amountCents: v.number(),
    method: v.optional(v.string()),
    note: v.optional(v.string()),
    /** Omit for "she just took the cash". Supplied only when catching up. */
    paidAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.amountCents)) {
      throw new Error("A payment has to be a whole number of cents.");
    }
    if (args.amountCents <= 0) {
      // Zero is a mis-tap, not a fact. Negative would be a refund, which is
      // a different event with its own reason and audit — not something to
      // sneak in through this door.
      throw new Error("A payment needs an amount.");
    }

    const order = await ctx.db.get(args.orderId);
    if (!order || order.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    if (order.status === "cancelled") {
      throw new Error("This order was cancelled.");
    }

    const now = Date.now();
    if (args.paidAt !== undefined) {
      if (!Number.isFinite(args.paidAt)) {
        throw new Error("That payment date doesn't look right.");
      }
      // The past is unbounded — she must be able to catch up on a Sunday.
      // The future is not: a phone with a wrong clock would otherwise
      // poison the cash-received view.
      if (args.paidAt > now + MAX_FUTURE_MS) {
        throw new Error("That payment date is in the future.");
      }
    }

    const paymentId = await insertPaymentRow(ctx, {
      orderId: args.orderId,
      amountCents: args.amountCents,
      paidAt: args.paidAt,
      method: args.method,
      note: args.note,
    });

    return { paymentId, ...(await paymentStateFor(ctx, order)) };
  },
});

/**
 * Undo a payment that never happened.
 *
 * This is CORRECTION, not a refund. "I mis-tapped" and "I gave the money
 * back" are different facts, and collapsing them would make cash-received
 * unable to tell them apart. Refunds do not exist yet.
 *
 * The owner may correct anything; staff may correct only their own tap, and
 * only while it is still plausibly "the thing I just did". A one-tap action
 * whose undo requires finding the owner is not an undo.
 */
export const remove = orgMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const payment = await ctx.db.get(paymentId);
    if (!payment || payment.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    if (!canRemovePayment(payment, ctx, Date.now())) {
      throw new ConvexError({ code: "FORBIDDEN" as const });
    }
    const order = await ctx.db.get(payment.orderId);
    await ctx.db.delete(paymentId);
    if (!order) return { orderId: payment.orderId, ...derive(0, 0) };
    return { orderId: order._id, ...(await paymentStateFor(ctx, order)) };
  },
});
