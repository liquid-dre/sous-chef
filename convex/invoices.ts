import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  orgMutation,
  orgQuery,
  publicMutation,
  orgIsWritable,
  publicQuery,
  type MutationCtx,
  type OrgCtx,
} from "./lib/functions";
import {
  computeInvoiceTotals,
  lineTotalCents,
  mergeLines,
} from "../lib/invoice-totals";
import { derive } from "./payments";

/**
 * The invoice: a rendering of an order, never a second entity.
 *
 * Three rules shape this file, and all three are about a document that leaves
 * her kitchen and may one day be shown to a tax authority.
 *
 * 1. **A number is allocated when the document is first materialised**, never
 *    at order creation. Numbering at creation burns one on every two-tap
 *    market-stall sale, and a dense number series whose documents do not exist
 *    is exactly the shape an auditor asks about. Every number here has paper
 *    behind it.
 * 2. **The document's identity freezes with its number.** Prefix and ZWG rate
 *    are stamped alongside it, for the same reason `taxRateBpAtCreation`
 *    exists: renaming the prefix in Settings must not relabel invoices already
 *    sent, and in an economy where the ZWG rate moves weekly a reprint that
 *    disagrees with the customer's paper copy is a dispute Sous caused.
 * 3. **`byToken` is the only unauthenticated read in Sous.** `publicQuery` is
 *    a bare alias of Convex's raw `query` — no org resolution, no role, no
 *    tenancy. Everything below it is hand-rolled, and a mistake here exposes a
 *    kitchen to the open internet rather than to the wrong colleague.
 */

function requireProvisioned(org: Doc<"orgs"> | null): Doc<"orgs"> {
  if (!org) throw new Error("This kitchen has not been set up yet.");
  return org;
}

/** `INV-0042`, or null while no document exists. */
export function invoiceLabel(
  prefix: string,
  number: number | null | undefined,
): string | null {
  return number == null ? null : `${prefix}-${String(number).padStart(4, "0")}`;
}

/**
 * Which prefix and which ZWG rate this order's document carries.
 *
 * Materialised: the stamps, always. Not yet: the live org values, because a
 * draft preview should show her today's rate while she is quoting — it is the
 * act of issuing that freezes them.
 */
export function invoiceIdentity(order: Doc<"orders">, org: Doc<"orgs">) {
  const issued = order.invoiceNumber != null;
  return {
    number: order.invoiceNumber ?? null,
    prefix: order.invoicePrefixAtInvoice ?? org.invoicePrefix,
    zwgRateMilli: issued
      ? (order.zwgRateMilliAtInvoice ?? null)
      : org.zwgDisplayEnabled
        ? (org.zwgRateMilli ?? null)
        : null,
    revision: order.revision,
    sentAt: order.sentAt ?? null,
  };
}

/**
 * The customer's view of the lines.
 *
 * A line served partly off the shelf and partly fresh is stored as two rows,
 * because each carries its own stamped cost — but "Brownies ×3" and
 * "Brownies ×2" on one invoice is the kitchen's bookkeeping leaking onto her
 * customer's page. Pure over rows so the invoice, the order screen and the
 * payment ledger can all group identically; see the rounding note in
 * payments.totalsFor for why "identically" is load-bearing.
 */
export function groupInvoiceLines(
  rows: Doc<"orderLines">[],
  nameOf: (id: Id<"menuItems">) => string,
) {
  return mergeLines(rows).map(({ rows: bucket, qtyMilli, unitPriceCents }) => {
    const row = bucket[0];
    return {
      id: row._id,
      menuItemId: row.menuItemId ?? null,
      description: row.menuItemId
        ? nameOf(row.menuItemId)
        : (row.description ?? ""),
      qtyMilli,
      unitPriceCents,
      lineTotalCents: lineTotalCents({
        description: "",
        qtyMilli,
        unitPriceCents,
      }),
      uncosted: row.uncosted,
      /** How much of this line came off the shelf rather than the oven. */
      fromStockMilli: bucket
        .filter((r) => r.fulfilledFromProductionLogId)
        .reduce((s, r) => s + r.qtyMilli, 0),
    };
  });
}

/** The tax the ORDER stamped, never the live org. */
export function invoiceTaxOf(order: Doc<"orders">) {
  return {
    enabled: order.taxRateBpAtCreation > 0,
    rateBp: order.taxRateBpAtCreation,
    inclusive: order.taxInclusiveAtCreation,
  };
}

// --- Issuing ---------------------------------------------------------------

/**
 * Allocate the next number, if this order has never had one.
 *
 * The org doc is already in the transaction's read set, so two taps racing
 * here conflict on it and the loser retries against the new sequence: two
 * distinct numbers, never one number twice. That is the whole concurrency
 * story, and it is Convex's OCC rather than anything written here — which is
 * why this must stay a plain read-modify-write inside ONE mutation and must
 * never be "optimised" into a read outside it.
 */
async function ensureNumber(
  ctx: MutationCtx & OrgCtx,
  order: Doc<"orders">,
  org: Doc<"orgs">,
): Promise<{ number: number; prefix: string }> {
  if (order.invoiceNumber != null) {
    return {
      number: order.invoiceNumber,
      prefix: order.invoicePrefixAtInvoice ?? org.invoicePrefix,
    };
  }
  const number = org.invoiceSequence + 1;
  await ctx.db.patch(org._id, { invoiceSequence: number });
  await ctx.db.patch(order._id, {
    invoiceNumber: number,
    invoicePrefixAtInvoice: org.invoicePrefix,
    // Absence IS the show-ZWG flag downstream, so an org with the line
    // switched off stamps nothing rather than stamping a rate it won't print.
    zwgRateMilliAtInvoice: org.zwgDisplayEnabled
      ? org.zwgRateMilli
      : undefined,
  });
  return { number, prefix: org.invoicePrefix };
}

async function loadOrder(
  ctx: MutationCtx & OrgCtx,
  orderId: Id<"orders">,
): Promise<Doc<"orders">> {
  const order = await ctx.db.get(orderId);
  if (!order || order.orgId !== ctx.orgId) {
    throw new ConvexError({ code: "NOT_FOUND" as const });
  }
  return order;
}

/**
 * Give this order a document. Idempotent — she can tap Invoice all day and
 * the series does not move.
 *
 * orgMutation: issuing an invoice is staff work, and nothing here is a cost.
 */
export const materialise = orgMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const org = requireProvisioned(ctx.org);
    const order = await loadOrder(ctx, orderId);
    const { number, prefix } = await ensureNumber(ctx, order, org);
    return {
      number,
      prefix,
      label: invoiceLabel(prefix, number)!,
      token: order.invoiceToken,
    };
  },
});

/**
 * It left the kitchen.
 *
 * Idempotent: re-sharing the same link is not a second send, and treating it
 * as one would print "Revision 1" on a document nobody had yet received.
 * Downloading a PDF for her own records deliberately does NOT come through
 * here — a revision may only appear on something a customer could already
 * hold a different version of.
 */
export const markSent = orgMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const org = requireProvisioned(ctx.org);
    const order = await loadOrder(ctx, orderId);
    const { number, prefix } = await ensureNumber(ctx, order, org);
    const sentAt = order.sentAt ?? Date.now();
    if (order.sentAt === undefined) {
      await ctx.db.patch(order._id, { sentAt });
    }
    return {
      number,
      prefix,
      label: invoiceLabel(prefix, number)!,
      token: order.invoiceToken,
      sentAt,
    };
  },
});

/**
 * Give this invoice a new link and kill the old one.
 *
 * "Revoke" in the shape the actual situation takes: she sent it to the wrong
 * number, and she still has to send it to the right one — a link that dies
 * with no replacement leaves her stuck mid-job.
 *
 * `sentAt` SURVIVES. A PDF is out there and someone may be holding it, so a
 * later edit must still bump the revision; clearing it would silently switch
 * that protection off. `invoiceViewedAt` is cleared, because the new link has
 * been opened by nobody and carrying the old view forward would be a claim
 * about a document that did not exist yet.
 */
export const replaceToken = orgMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await loadOrder(ctx, orderId);
    const invoiceToken = `i_${crypto.randomUUID()}`;
    await ctx.db.patch(order._id, {
      invoiceToken,
      invoiceViewedAt: undefined,
    });
    return { token: invoiceToken };
  },
});

/**
 * Everything the email route needs, in one tenanted read.
 *
 * It exists so the recipient is never taken from the client. A route handler
 * that accepts `to:` from the browser is a spam relay wearing her domain's
 * reputation, and reputation is the only thing standing between her invoices
 * and the junk folder.
 *
 * orgQuery, and carries no cost: sending an invoice is staff work.
 */
export const deliveryPayload = orgQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const org = requireProvisioned(ctx.org);
    const order = await ctx.db.get(orderId);
    if (!order || order.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const customer = order.customerId
      ? await ctx.db.get(order.customerId)
      : null;
    const identity = invoiceIdentity(order, org);
    if (identity.number == null) {
      // Nothing to send. The caller materialises first; this refuses rather
      // than quietly emailing a document with no number on it.
      throw new ConvexError({ code: "NOT_ISSUED" as const });
    }

    const lines = await ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", order._id),
      )
      .collect();
    const totals = computeInvoiceTotals({
      lines: mergeLines(lines).map((l) => ({
        description: "",
        qtyMilli: l.qtyMilli,
        unitPriceCents: l.unitPriceCents,
      })),
      deliveryFeeCents: order.deliveryFeeCents,
      discountCents: order.discountCents,
      tax: invoiceTaxOf(order),
      depositPercent: order.depositPercent ?? null,
    });
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", order._id),
      )
      .collect();
    const money = derive(
      totals.totalCents,
      payments.reduce((s, p) => s + p.amountCents, 0),
    );

    return {
      token: order.invoiceToken,
      label: invoiceLabel(identity.prefix, identity.number)!,
      /** Absent for most customers — phone is the identity key and email is
       * optional, so the caller must handle "no way to email this". */
      to: customer?.email ?? null,
      customerName: customer?.name ?? null,
      orgName: org.name,
      /** Resend sends from a Sous domain; a reply has to reach HER. Falls
       * back to the public contact address when no reply-to is set, because
       * an unanswerable invoice is worse than a slightly wrong From. */
      replyTo: org.replyTo ?? org.email ?? null,
      balanceCents: money.balanceCents,
      totalCents: money.totalCents,
      deliveryDate: order.deliveryDate,
      cancelled: order.status === "cancelled",
    };
  },
});

// --- Delivery status -------------------------------------------------------

export type DeliveryStatus = "notSent" | "sent" | "viewed";

/**
 * Derived, never stored — the same doctrine as payment status and overhang
 * expiry. Two timestamps already say everything a third field could, and a
 * stored status is one more thing that can disagree with the facts.
 */
export function deliveryStatusOf(order: Doc<"orders">): DeliveryStatus {
  if (order.invoiceViewedAt !== undefined) return "viewed";
  if (order.sentAt !== undefined) return "sent";
  return "notSent";
}

/**
 * One edit session, one revision.
 *
 * "Exactly once per edit session" is guaranteed by atomicity, not by tracking
 * sessions: a mutation is the session. Any mutation that changes what a sent
 * document says must call this exactly once, and must batch its changes into
 * that single mutation rather than calling several — which is the right shape
 * for an order edit anyway.
 *
 * Silent before the send, because a draft has no reader to inform.
 */
export async function bumpRevision(
  ctx: MutationCtx & OrgCtx,
  order: Doc<"orders">,
): Promise<void> {
  if (order.sentAt === undefined) return;
  await ctx.db.patch(order._id, { revision: order.revision + 1 });
}

// --- The public read -------------------------------------------------------

/**
 * The customer's copy. Unauthenticated by design: the token IS the
 * authorisation.
 *
 * `publicQuery` is a bare alias of raw `query` — it resolves no org, checks no
 * role and validates no token. Every guard below is therefore load-bearing,
 * and the payload is assembled field by field rather than spread from a
 * document, so a future column added to `orders` or `orderLines` cannot leak
 * by default. There is no cost, no margin and no cogsSnapshot anywhere in it,
 * and convex/invoices.test.ts asserts that on the serialised bytes.
 */
export const byToken = publicQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    // Cheap shape check first: a feedback token pasted into the invoice route
    // should fail here rather than after an index scan.
    if (!token.startsWith("i_")) return null;

    const order = await ctx.db
      .query("orders")
      .withIndex("by_invoiceToken", (q) => q.eq("invoiceToken", token))
      .unique();
    if (!order) return null;
    // Never materialised means never shared, so this link cannot legitimately
    // be in anyone's hands. Reads as "not active" rather than as an error.
    if (order.invoiceNumber == null) return null;

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_orgId", (q) => q.eq("orgId", order.orgId))
      .unique();
    if (!org) return null;
    // A disabled org goes READ-ONLY, never deleted (CONTEXT.md — Access). Her
    // customer must not lose the invoice they were sent because Sous switched
    // her kitchen off.

    const customer = order.customerId
      ? await ctx.db.get(order.customerId)
      : null;

    const lineRows = await ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", order.orgId).eq("orderId", order._id),
      )
      .collect();

    const names = new Map<string, string>();
    for (const row of lineRows) {
      if (row.menuItemId && !names.has(row.menuItemId)) {
        const item = await ctx.db.get(row.menuItemId);
        names.set(row.menuItemId, item?.name ?? "(removed)");
      }
    }
    const grouped = groupInvoiceLines(
      lineRows,
      (id) => names.get(id) ?? "(removed)",
    );

    const totals = computeInvoiceTotals({
      lines: grouped.map((l) => ({
        description: l.description,
        qtyMilli: l.qtyMilli,
        unitPriceCents: l.unitPriceCents,
      })),
      deliveryFeeCents: order.deliveryFeeCents,
      discountCents: order.discountCents,
      tax: invoiceTaxOf(order),
      depositPercent: order.depositPercent ?? null,
    });

    const paymentRows = await ctx.db
      .query("payments")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", order.orgId).eq("orderId", order._id),
      )
      .collect();
    const money = derive(
      totals.totalCents,
      paymentRows.reduce((s, p) => s + p.amountCents, 0),
    );

    const identity = invoiceIdentity(order, org);

    return {
      org: {
        name: org.name,
        logoUrl: org.logo ? await ctx.storage.getUrl(org.logo) : null,
        address: org.address ?? null,
        phone: org.phone ?? null,
        email: org.email ?? null,
        socials: org.socials,
      },
      palette: org.palette,
      invoice: {
        prefix: identity.prefix,
        number: identity.number!,
        revision: identity.revision,
      },
      customer: customer
        ? {
            name: customer.name,
            phone: customer.phone,
            address: customer.address ?? null,
          }
        : null,
      orderDate: order.orderDate,
      deliveryDate: order.deliveryDate,
      cancelled: order.status === "cancelled",
      lines: grouped.map((l) => ({
        description: l.description,
        qtyMilli: l.qtyMilli,
        unitPriceCents: l.unitPriceCents,
      })),
      deliveryFeeCents: order.deliveryFeeCents,
      discountCents: order.discountCents,
      tax: invoiceTaxOf(order),
      depositPercent: order.depositPercent ?? null,
      payments: {
        paidCents: money.paidCents,
        balanceCents: money.balanceCents,
        excessCents: money.excessCents,
      },
      paymentInstructions: org.paymentInstructions ?? null,
      terms: org.terms ?? null,
      zwgRateMilli: identity.zwgRateMilli,
    };
  },
});

/**
 * Somebody opened it.
 *
 * The first UNAUTHENTICATED WRITE in Sous, which is why every line of it is
 * defensive:
 *
 * - It is called from the browser AFTER hydration, never from the page
 *   request. WhatsApp, Gmail and iMessage fetch a shared URL to build their
 *   preview card, so a server-side record would fire the moment she pressed
 *   send and "viewed" would mean "sent" — an inverted signal on the one thing
 *   she uses to decide whether to chase a debt. Previewers pull HTML; they do
 *   not run React. This also excludes the PDF render for free, because
 *   Chromium loads /print.
 * - It takes a token and NOTHING else, so there is no field a caller can
 *   steer.
 * - It returns null unconditionally — for a real token, a wrong token and a
 *   feedback token alike. A caller cannot use it to find out whether a token
 *   exists, which matters because the token IS the authorisation.
 * - It writes once. A second call is a no-op, so the row cannot be grown or
 *   the timestamp walked forward by anyone hammering the endpoint.
 */
export const recordView = publicMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<null> => {
    if (!token.startsWith("i_")) return null;
    const order = await ctx.db
      .query("orders")
      .withIndex("by_invoiceToken", (q) => q.eq("invoiceToken", token))
      .unique();
    // Every one of these returns the same null the success path does.
    if (!order) return null;
    if (order.invoiceNumber == null) return null;
    if (order.invoiceViewedAt !== undefined) return null;
    // A disabled kitchen is read-only, and a view stamp is still a write.
    // `publicMutation` is a bare alias of the raw builder, so nothing else in
    // this handler's path would have stopped it. The invoice itself stays
    // readable — see byToken — she simply stops learning who opened it.
    if (!(await orgIsWritable(ctx, order.orgId))) return null;
    await ctx.db.patch(order._id, { invoiceViewedAt: Date.now() });
    return null;
  },
});
