import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { orgMutation, orgQuery, ownerQuery } from "./lib/functions";
import { costItem } from "./lib/costing";
import { loadWorld } from "./lib/world";
import { occasion } from "./schema";
import {
  computeInvoiceTotals,
  lineTotalCents,
  marginRevenueCents,
  type InvoiceTotals,
} from "../lib/invoice-totals";
import {
  computeDeliveryFeeCents,
  deliveryCostPrefillCents,
} from "../lib/delivery-fee";
import { normalisePhone, phoneDigits } from "../lib/phone";
import {
  canRemovePayment,
  derive,
  insertPaymentRow,
  totalsFor,
  UNDO_WINDOW_MS,
} from "./payments";
import {
  commitSellDown,
  endOfDayMs,
  planSellDown,
  restoreSellDown,
} from "./production";
import {
  bumpRevision,
  deliveryStatusOf,
  groupInvoiceLines,
  invoiceIdentity,
  invoiceLabel,
  invoiceTaxOf,
} from "./invoices";

/**
 * Orders. This is the slice that writes the record history is stuck with:
 * cogsSnapshot per line, the tax stamp and the deposit percent per order,
 * written once at creation and never recomputed. Everything the dashboard,
 * invoicing and analytics ever say about last month is decided here.
 *
 * Two rules shape the whole file:
 *
 * 1. Money is decided server-side. The client says what she picked; the
 *    server says what it costs. A fee or a discount taken on trust from the
 *    client is a number nobody can stand behind.
 * 2. Costs are written for her, not shown to staff. Order entry is staff
 *    work, so `create` runs as orgMutation and snapshots cost layers a staff
 *    caller can never read back.
 */

function requireProvisioned(org: Doc<"orgs"> | null): Doc<"orgs"> {
  // orgMutation does NOT throw on a null org — without this, the first read
  // of org.invoiceSequence is a TypeError rather than a sentence.
  if (!org) throw new Error("This kitchen has not been set up yet.");
  return org;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const orderLineArg = v.object({
  /** Absent for off-menu lines. */
  menuItemId: v.optional(v.id("menuItems")),
  /** Required for off-menu lines; menu lines render from the item. */
  description: v.optional(v.string()),
  qtyMilli: v.number(),
  /** Menu lines fall back to the item's price. */
  unitPriceCents: v.optional(v.number()),
  /** Off-menu gut-check figure. Owner-only. */
  roughCostCents: v.optional(v.number()),
});

interface ResolvedLine {
  menuItemId?: Id<"menuItems">;
  description?: string;
  qtyMilli: number;
  unitPriceCents: number;
  cogsSnapshot?: {
    ingredientsCents: number;
    perUnitExtrasCents: number;
    overheadCents: number;
  };
  roughCostCents?: number;
  uncosted: boolean;
  /** Set when this row came off the shelf rather than out of the oven. */
  fulfilledFromProductionLogId?: Id<"productionLogs">;
  /** For the totals call, which wants a description on every line. */
  label: string;
}

export const create = orgMutation({
  args: {
    /** An explicit pick beats phone matching; phone is still the identity. */
    customerId: v.optional(v.id("customers")),
    phone: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    address: v.optional(v.string()),

    /** HER local day, from the client. A server Date.now() would misfile
     * every order taken after midnight in Harare into the previous day. */
    orderDate: v.string(),
    deliveryDate: v.string(),
    deliveryAddress: v.optional(v.string()),
    occasion: v.optional(occasion),

    lines: v.array(orderLineArg),
    discountCents: v.optional(v.number()),

    deliveryKmMilli: v.optional(v.number()),
    /** "Waive it this once." Revenue, so any member may set it. */
    deliveryFeeCentsOverride: v.optional(v.number()),
    /** Her cost side. Owner-only. */
    deliveryCostCents: v.optional(v.number()),

    source: v.optional(v.union(v.literal("app"), v.literal("quickSale"))),
  },
  handler: async (ctx, args) => {
    const org = requireProvisioned(ctx.org);

    // --- shape ---
    if (args.lines.length === 0) {
      throw new Error("An order needs at least one item.");
    }
    if (!DAY.test(args.orderDate) || !DAY.test(args.deliveryDate)) {
      throw new Error("Dates need to look like 2026-08-04.");
    }
    // ISO days compare correctly as strings. A delivery date in the PAST is
    // fine — back-entering last week's sale is the whole point of being able
    // to catch up on a Sunday.
    if (args.deliveryDate < args.orderDate) {
      throw new Error("Delivery cannot be before the order.");
    }
    if (!args.phone.trim()) throw new Error("A customer needs a phone number.");
    if (!args.name.trim()) throw new Error("A customer needs a name.");
    if ((args.discountCents ?? 0) < 0) {
      throw new Error("A discount cannot be negative.");
    }

    // --- staff may not send cost data ---
    const sendsCost =
      args.deliveryCostCents !== undefined ||
      args.lines.some((l) => l.roughCostCents !== undefined);
    if (sendsCost && ctx.role !== "owner") {
      throw new ConvexError({ code: "FORBIDDEN" as const });
    }

    // --- customer ---
    const phone = normalisePhone(args.phone);
    let customer: Doc<"customers"> | null = null;
    if (args.customerId) {
      customer = await ctx.db.get(args.customerId);
      if (!customer || customer.orgId !== ctx.orgId) {
        throw new ConvexError({ code: "NOT_FOUND" as const });
      }
    } else {
      // .first(), never .unique(): imported data can legitimately hold two
      // rows on one number, and .unique() would throw away her whole order
      // over a duplicate she did not create.
      customer = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) =>
          q.eq("orgId", ctx.orgId).eq("phone", phone),
        )
        .first();
    }

    let customerId: Id<"customers">;
    if (customer) {
      customerId = customer._id;
      // The stored name wins. "Tariro" typed in a hurry must not overwrite
      // "Tariro Moyo" — and opting out is permanent, so consent is never
      // flipped back on by a later order.
      const patch: Partial<Doc<"customers">> = {};
      if (!customer.email && args.email?.trim()) patch.email = args.email.trim();
      if (!customer.address && args.address?.trim()) {
        patch.address = args.address.trim();
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(customerId, patch);
    } else {
      customerId = await ctx.db.insert("customers", {
        orgId: ctx.orgId,
        name: args.name.trim(),
        phone,
        email: args.email?.trim() || undefined,
        address: args.address?.trim() || undefined,
        marketingConsent: true,
        consentSource: "order",
      });
    }

    // --- lines, resolved before anything is written ---
    const world = await loadWorld(ctx);
    const resolved: ResolvedLine[] = [];

    for (const line of args.lines) {
      if (!Number.isFinite(line.qtyMilli) || line.qtyMilli <= 0) {
        throw new Error("Every line needs a quantity.");
      }

      if (line.menuItemId) {
        const item = await ctx.db.get(line.menuItemId);
        // Before costItem: it returns zeros for an unknown id rather than
        // throwing, so a deleted item would otherwise snapshot as free.
        if (!item || item.orgId !== ctx.orgId) {
          throw new ConvexError({ code: "NOT_FOUND" as const });
        }
        // Before the price check: sub-recipes have no price by construction,
        // so the other order would tell her the wrong thing.
        if (item.notSoldDirectly) {
          throw new Error(
            `${item.name} is a sub-recipe — it isn't sold on its own.`,
          );
        }
        const unitPriceCents = line.unitPriceCents ?? item.priceCents;
        if (unitPriceCents == null) {
          throw new Error(`${item.name} has no price yet.`);
        }
        if (unitPriceCents < 0) throw new Error("A price cannot be negative.");

        const costing = costItem(item._id, world);
        resolved.push({
          menuItemId: item._id,
          qtyMilli: line.qtyMilli,
          unitPriceCents,
          // Per unit, integer cents. costItem works in fractional cents
          // (176.5/12); rounding per layer costs at most 1.5c a unit, about
          // half a point of margin on a $3 item. Do not "fix" this by
          // storing floats — the schema's first rule is integer cents.
          cogsSnapshot: {
            ingredientsCents: Math.round(costing.ingredients.centsPerUnit),
            perUnitExtrasCents: Math.round(costing.extras.centsPerUnit),
            overheadCents: Math.round(costing.overhead.centsPerUnit),
          },
          uncosted: false,
          label: item.name,
        });
      } else {
        const description = line.description?.trim();
        if (!description) {
          throw new Error("An off-menu line needs a description.");
        }
        // 0 is a legal price (a freebie). Only "never said" is refused.
        if (line.unitPriceCents == null) {
          throw new Error(`${description} needs a price.`);
        }
        if (line.unitPriceCents < 0) {
          throw new Error("A price cannot be negative.");
        }
        resolved.push({
          description,
          qtyMilli: line.qtyMilli,
          unitPriceCents: line.unitPriceCents,
          roughCostCents: line.roughCostCents,
          uncosted: true,
          label: description,
        });
      }
    }

    // --- what is already on the shelf comes off it first ---
    // Before the money, deliberately: an allocation can SPLIT a line (3 off
    // an old batch at its stamped cost, 2 fresh at today's), and
    // lineTotalCents rounds — so totalling the unsplit line and then
    // splitting would leave the payment a cent short of the rows.
    const deliveryInstant = endOfDayMs(args.deliveryDate);
    const running = new Map<string, number>();
    const allocated: ResolvedLine[] = [];
    for (const line of resolved) {
      if (!line.menuItemId || !line.cogsSnapshot) {
        allocated.push(line);
        continue;
      }
      const plan = await planSellDown(ctx, {
        menuItemId: line.menuItemId,
        qtyMilli: line.qtyMilli,
        deliveryInstant,
        liveSnapshot: line.cogsSnapshot,
        // Shared across every line of the order, so "Brownies ×3" twice
        // cannot be handed the same three units.
        running,
      });
      for (const a of plan) {
        allocated.push({
          ...line,
          qtyMilli: a.qtyMilli,
          cogsSnapshot: a.cogsSnapshot,
          fulfilledFromProductionLogId: a.productionLogId ?? undefined,
        });
      }
      await commitSellDown(ctx, plan);
    }

    // --- money, decided here ---
    const subtotalCents = allocated.reduce(
      (sum, l) => sum + lineTotalCents({ ...l, description: l.label }),
      0,
    );
    // Store the CLAMPED value so orders.discountCents is never a number that
    // lies about what came off.
    const discountCents = Math.min(args.discountCents ?? 0, subtotalCents);
    const goodsCents = subtotalCents - discountCents;

    const deliveryFeeCents =
      args.deliveryFeeCentsOverride ??
      computeDeliveryFeeCents({
        model: org.deliveryFeeModel,
        config: org.deliveryFeeConfig,
        goodsCents,
        kmMilli: args.deliveryKmMilli,
      }).cents;

    // NO invoice number here. It is allocated when the document is first
    // materialised (convex/invoices.ts) so that every number has a document
    // behind it — numbering at creation burns one on every market-stall quick
    // sale, and an auditor asking to see INV-0847 gets "that was a $2 scone,
    // there is no invoice."
    //
    // Tax still locks on the first order: the stamp is what the lock protects.
    await ctx.db.patch(org._id, { taxLocked: true });

    const orderId = await ctx.db.insert("orders", {
      orgId: ctx.orgId,
      customerId,
      orderDate: args.orderDate,
      deliveryDate: args.deliveryDate,
      deliveryAddress: args.deliveryAddress?.trim() || undefined,
      status: "confirmed",
      occasion: args.occasion,
      deliveryFeeCents,
      deliveryCostCents: args.deliveryCostCents ?? 0,
      deliveryKmMilli:
        org.deliveryFeeModel === "perKm" ? args.deliveryKmMilli : undefined,
      discountCents,
      taxInclusiveAtCreation: org.taxInclusive,
      // NOT org.taxRateBp unconditionally: there is no taxEnabledAtCreation,
      // so a stale non-zero rate stamped while tax was off would start
      // printing tax she never charged the day she switches VAT on.
      taxRateBpAtCreation: org.taxEnabled ? org.taxRateBp : 0,
      depositPercent: org.defaultDepositPercent || undefined,
      revision: 0,
      source: args.source ?? "app",
      // Prefixed so a token pasted into the wrong public route fails fast.
      feedbackToken: `f_${crypto.randomUUID()}`,
      invoiceToken: `i_${crypto.randomUUID()}`,
    });

    for (const line of allocated) {
      await ctx.db.insert("orderLines", {
        orgId: ctx.orgId,
        orderId,
        menuItemId: line.menuItemId,
        description: line.description,
        qtyMilli: line.qtyMilli,
        unitPriceCents: line.unitPriceCents,
        cogsSnapshot: line.cogsSnapshot,
        roughCostCents: line.roughCostCents,
        uncosted: line.uncosted,
        fulfilledFromProductionLogId: line.fulfilledFromProductionLogId,
      });
    }

    return { orderId };
  },
});

/** What the order is worth, and — for the owner only — what it cost. */
export const get = orgQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const org = requireProvisioned(ctx.org);
    const order = await ctx.db.get(orderId);
    if (!order || order.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    // Absent on a walk-in. The payload already returned `customer: null`
    // for a missing row before this was optional, so only the read needed
    // guarding.
    const customer = order.customerId
      ? await ctx.db.get(order.customerId)
      : null;
    const lineRows = await ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", orderId),
      )
      .collect();

    const names = new Map<string, string>();
    for (const row of lineRows) {
      if (row.menuItemId && !names.has(row.menuItemId)) {
        const item = await ctx.db.get(row.menuItemId);
        names.set(row.menuItemId, item?.name ?? "(removed)");
      }
    }

    // Grouped for the customer — the shared helper, so the invoice she sends,
    // this screen and the payment ledger cannot round a split line three
    // different ways. orderCosting below keeps iterating the raw rows, where
    // the split is the whole point.
    const lines = groupInvoiceLines(
      lineRows,
      (id) => names.get(id) ?? "(removed)",
    );

    // Tax from the STAMP, never from the live org — that is the entire point
    // of stamping it.
    const totals: InvoiceTotals = computeInvoiceTotals({
      lines: lines.map((l) => ({
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
        q.eq("orgId", ctx.orgId).eq("orderId", orderId),
      )
      .collect();
    const paidCents = paymentRows.reduce((s, p) => s + p.amountCents, 0);
    const money = derive(totals.totalCents, paidCents);
    const now = Date.now();

    // Stamped once issued, live while still a draft — so the quoting preview
    // shows today's ZWG rate but a reprint shows the customer's.
    const identity = invoiceIdentity(order, org);

    return {
      order: {
        id: order._id,
        /** Null until she issues one. There is no document yet, and printing
         * a number for one would be the gap an auditor asks about. */
        invoiceNumber: identity.number,
        invoicePrefix: identity.prefix,
        invoiceLabel: invoiceLabel(identity.prefix, identity.number),
        invoiceToken: order.invoiceToken,
        revision: order.revision,
        status: order.status,
        cancellationReason: order.cancellationReason ?? null,
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        deliveryAddress: order.deliveryAddress ?? null,
        occasion: order.occasion ?? null,
        source: order.source,
        sentAt: order.sentAt ?? null,
        viewedAt: order.invoiceViewedAt ?? null,
        /** Derived from the two timestamps, never stored — the same rule as
         * payment status. A third field could only ever disagree with them. */
        deliveryStatus: deliveryStatusOf(order),
      },
      customer: customer
        ? {
            id: customer._id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email ?? null,
            address: customer.address ?? null,
          }
        : null,
      lines,
      totals,
      payments: {
        ...money,
        rows: paymentRows
          .sort((a, b) => a.paidAt - b.paidAt)
          .map((p) => ({
            id: p._id,
            amountCents: p.amountCents,
            paidAt: p.paidAt,
            method: p.method ?? null,
            note: p.note ?? null,
            // Server-computed, so the UI never renders a button the server
            // would refuse.
            canRemove: canRemovePayment(p, ctx, now),
          })),
        /** The deposit, one tap. Reads the ORDER's stamped percent, never the
         * live org default — an order created in March at 50% must keep
         * offering 50% after she changes the default in June, because the
         * invoice she already sent says 50%. */
        depositShown:
          order.status !== "cancelled" &&
          paidCents === 0 &&
          (order.depositPercent ?? 0) > 0 &&
          money.balanceCents > 0,
        depositCents: Math.min(totals.depositCents, money.balanceCents),
      },
      /** The letterhead. Not cost data — but it lives only behind the
       * owner-only getProfile, and staff render invoices too. */
      invoiceOrg: {
        name: org.name,
        // The invoice wears the kitchen's mark and its palette; getProfile is
        // owner-only and staff issue invoices, so both arrive here.
        logoUrl: org.logo ? await ctx.storage.getUrl(org.logo) : null,
        palette: org.palette,
        address: org.address ?? null,
        phone: org.phone ?? null,
        email: org.email ?? null,
        socials: org.socials,
        paymentInstructions: org.paymentInstructions ?? null,
        terms: org.terms ?? null,
        zwgRateMilli: identity.zwgRateMilli,
      },
      costing:
        ctx.role === "owner"
          ? orderCosting(order, lineRows, lines, totals, org)
          : null,
    };
  },
});

/**
 * The owner's cost view of an order.
 *
 * Two things this does that the naive version gets wrong:
 *
 * - Margins are measured against revenue with any INCLUSIVE tax removed.
 *   Under an inclusive model the goods figure contains tax that is not hers,
 *   and counting it would read about thirteen points better than reality.
 * - Margins are measured on the COSTED share only. An off-menu line's
 *   revenue lands in the goods figure while its cost is excluded from every
 *   aggregate by design, so counting both would flatter exactly the orders
 *   Sous understands least. What it cannot analyse is reported separately.
 */
function orderCosting(
  order: Doc<"orders">,
  rows: Doc<"orderLines">[],
  lines: { id: Id<"orderLines">; lineTotalCents: number; uncosted: boolean }[],
  totals: InvoiceTotals,
  org: Doc<"orgs">,
) {
  const revenue = marginRevenueCents(totals);
  const costedGross = lines
    .filter((l) => !l.uncosted)
    .reduce((s, l) => s + l.lineTotalCents, 0);
  const uncostedGross = lines
    .filter((l) => l.uncosted)
    .reduce((s, l) => s + l.lineTotalCents, 0);

  // The order-level discount belongs to every line in proportion to what it
  // contributed, so the costed share carries its fair part of it.
  const costedShare = totals.subtotalCents > 0 ? costedGross / totals.subtotalCents : 0;
  const costedRevenue = Math.round(revenue * costedShare);

  let layer12 = 0;
  let layer3 = 0;
  for (const row of rows) {
    if (!row.cogsSnapshot) continue;
    const units = row.qtyMilli / 1000;
    layer12 += Math.round(
      (row.cogsSnapshot.ingredientsCents + row.cogsSnapshot.perUnitExtrasCents) *
        units,
    );
    layer3 += Math.round(row.cogsSnapshot.overheadCents * units);
  }

  const netRevenue = costedRevenue + order.deliveryFeeCents;
  const netCost = layer12 + layer3 + order.deliveryCostCents;

  return {
    deliveryCostCents: order.deliveryCostCents,
    costedGoodsCents: costedGross,
    /** CONTEXT.md's "% of revenue Sous cannot analyse", per order. */
    uncostedGoodsCents: uncostedGross,
    layer12Cents: layer12,
    layer3Cents: layer3,
    // Multiply before dividing — see the note in convex/lib/costing.ts.
    grossMarginPercent:
      costedRevenue > 0
        ? Math.round(((costedRevenue - layer12) * 100) / costedRevenue)
        : null,
    netMarginPercent:
      netRevenue > 0 ? Math.round(((netRevenue - netCost) * 100) / netRevenue) : null,
    leavesYouCents: netRevenue - netCost,
    /** False means layer 3 is zero by configuration, not by magic. */
    overheadRateSet: org.overheadRateCentsPerHour > 0,
    /** She charged for delivery but recorded no cost against it. */
    deliveryCostMissing:
      order.deliveryFeeCents > 0 && order.deliveryCostCents === 0,
    perLine: rows.map((row) => ({
      lineId: row._id,
      cogsSnapshot: row.cogsSnapshot ?? null,
      roughCostCents: row.roughCostCents ?? null,
    })),
  };
}

export const cancel = orgMutation({
  args: { orderId: v.id("orders"), reason: v.string() },
  handler: async (ctx, { orderId, reason }) => {
    const order = await ctx.db.get(orderId);
    if (!order || order.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    if (!reason.trim()) throw new Error("Say why it was cancelled.");
    if (order.status === "cancelled") {
      // Refusing protects the reason she gave the first time.
      throw new Error("This order is already cancelled.");
    }
    // A quick sale is the exception, and only because it is genuinely
    // different: it never produced an invoice anyone has seen, so cancelling
    // it erases nothing external. Without this a mis-tapped counter sale
    // found tomorrow would have no correction path at all — it is created
    // delivered, so this guard would be the last door closed.
    if (order.status === "delivered" && order.source !== "quickSale") {
      throw new Error(
        "This order was delivered. Cancelling it would erase a sale that happened.",
      );
    }

    // Only these two fields. Production logs and stock movements are left
    // exactly as they are — that is HOW the batch cost stays on the books as
    // waste (CONTEXT.md). Unwinding them would be the bug.
    await ctx.db.patch(orderId, {
      status: "cancelled",
      cancellationReason: reason.trim(),
    });
    // Cancelling changes what a sent document says, so it is an edit. No-ops
    // silently when nothing was ever sent, which is every quick sale.
    await bumpRevision(ctx, order);

    // A quick sale's payment was written by the same tap that made the sale,
    // so it is part of the same act: if the sale did not happen, neither did
    // the money. A deliberate order's payments are NOT touched — a deposit
    // taken before a wedding was called off is cash she genuinely holds, and
    // erasing it would make the ledger disagree with her bank.
    if (order.source === "quickSale") {
      const rows = await ctx.db
        .query("payments")
        .withIndex("by_org_order", (q) =>
          q.eq("orgId", ctx.orgId).eq("orderId", orderId),
        )
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }

    // Anything served off the shelf goes back on it. The food physically
    // exists — the cancellation is about the sale, not about the cake. Note
    // this releases a RESERVATION only: the pantry deduction and the batch's
    // stamped cost are untouched, which is how the batch cost stays on the
    // books. If the batch has expired by now, the returned units land in an
    // expired batch and read as waste immediately, which derived expiry gets
    // right with no extra code.
    const orderLines = await ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", orderId),
      )
      .collect();
    const overhangReturnedMilli = await restoreSellDown(ctx, orderLines);

    const logs = await ctx.db
      .query("productionLogs")
      .withIndex("by_org_producedAt", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const forThis = logs.filter((l) => l.orderIds.includes(orderId));
    return {
      productionLogged: forThis.length > 0,
      batchCount: forThis.reduce((s, l) => s + l.batchCount, 0),
      overhangReturnedMilli,
    };
  },
});

/** Three letters of a name or a phone number, as she types. */
export const searchCustomers = orgQuery({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const digits = phoneDigits(q);
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_org_name", (qq) => qq.eq("orgId", ctx.orgId))
      .collect();
    return rows
      .filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          (digits.length > 0 && phoneDigits(c.phone).includes(digits)),
      )
      .slice(0, 8)
      .map((c) => ({
        id: c._id,
        name: c.name,
        phone: c.phone,
        email: c.email ?? null,
        address: c.address ?? null,
      }));
  },
});

/** Everything the form needs to open. Revenue-side only. */
export const entryDefaults = orgQuery({
  args: {},
  handler: async (ctx) => {
    const org = requireProvisioned(ctx.org);
    return {
      deliveryFeeModel: org.deliveryFeeModel,
      deliveryFeeConfig: org.deliveryFeeConfig,
      taxEnabled: org.taxEnabled,
      taxRateBp: org.taxRateBp,
      taxInclusive: org.taxInclusive,
      invoicePrefix: org.invoicePrefix,
      // No nextInvoiceNumber. Nothing consumed it, and since numbers are
      // allocated on issue it could only ever have been a guess — two orders
      // taken before either is invoiced would both be told they are next.
      defaultDepositPercent: org.defaultDepositPercent,
    };
  },
});

/**
 * What this delivery probably costs her. Owner-only: deliveryCostCentsPerKm
 * and a previous order's delivery cost are her cost side, and staff never
 * see costs. A staff-created order therefore records zero, and the
 * saved-order view tells the owner so.
 */
export const deliveryCostPrefill = ownerQuery({
  args: {
    kmMilli: v.optional(v.number()),
    customerId: v.optional(v.id("customers")),
  },
  handler: async (ctx, { kmMilli, customerId }) => {
    const org = requireProvisioned(ctx.org);

    if (org.deliveryFeeModel === "perKm" && kmMilli && kmMilli > 0) {
      return {
        cents: deliveryCostPrefillCents(kmMilli, org.deliveryCostCentsPerKm),
        source: "perKm" as const,
      };
    }

    // Same customer, same suburb, same fuel — so hers first.
    if (customerId) {
      const last = await ctx.db
        .query("orders")
        .withIndex("by_org_customer", (q) =>
          q.eq("orgId", ctx.orgId).eq("customerId", customerId),
        )
        .order("desc")
        .first();
      if (last) {
        return { cents: last.deliveryCostCents, source: "lastForCustomer" as const };
      }
    }

    const anyLast = await ctx.db
      .query("orders")
      .withIndex("by_org_orderDate", (q) => q.eq("orgId", ctx.orgId))
      .order("desc")
      .first();
    if (anyLast) {
      return { cents: anyLast.deliveryCostCents, source: "lastForOrg" as const };
    }

    // Nothing to draw on. Blank, and the form asks.
    return { cents: null, source: null };
  },
});

// --- The list, and the two-tap counter sale --------------------------------

/**
 * The orders screen: one query, three readings of the same rows.
 *
 * Upcoming is the bake list, Owing is the chase list, All is the archive.
 * The split is total and has no overlap, which is what lets one screen carry
 * all three without a mode she has to hold in her head.
 */
export const list = orgQuery({
  args: {
    filter: v.union(
      v.literal("upcoming"),
      v.literal("owing"),
      v.literal("all"),
    ),
    /** HER local day. The server has no "today" — a UTC Date.now() would
     * misfile every order for anyone looking at this after 22:00 in Harare. */
    today: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { filter, today, limit }) => {
    const org = requireProvisioned(ctx.org);

    // Three prefix-bound reads, then Maps. NOT one query per order — the
    // same technique convex/lib/world.ts uses to pull every recipe line at
    // once, for the same reason.
    const [orders, allLines, allPayments, allFeedback] = await Promise.all([
      ctx.db
        .query("orders")
        .withIndex("by_org_orderDate", (q) => q.eq("orgId", ctx.orgId))
        .collect(),
      ctx.db
        .query("orderLines")
        .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
        .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
        .collect(),
      // A fourth prefix-bound read, for the same reason as the other three:
      // "log feedback" is ONE TAP from this list (CONTEXT.md — Feedback), and
      // one tap means the sheet already knows what to ask.
      ctx.db
        .query("feedback")
        .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
        .collect(),
    ]);

    const linesBy = new Map<string, Doc<"orderLines">[]>();
    for (const line of allLines) {
      const bucket = linesBy.get(line.orderId);
      if (bucket) bucket.push(line);
      else linesBy.set(line.orderId, [line]);
    }
    const paidBy = new Map<string, number>();
    for (const p of allPayments) {
      paidBy.set(p.orderId, (paidBy.get(p.orderId) ?? 0) + p.amountCents);
    }

    const feedbackBy = new Map<string, { chef: number; customer: number }>();
    for (const row of allFeedback) {
      const counts = feedbackBy.get(row.orderId) ?? { chef: 0, customer: 0 };
      counts[row.source] += 1;
      feedbackBy.set(row.orderId, counts);
    }

    // One read per DISTINCT menu item across the whole list, not per line.
    // Only items with axes: the sheet asks about what she has set up, and
    // nothing else.
    const axesBy = new Map<string, { name: string; axes: string[] }>();
    for (const line of allLines) {
      if (!line.menuItemId || axesBy.has(line.menuItemId)) continue;
      const item = await ctx.db.get(line.menuItemId);
      if (!item) continue;
      axesBy.set(line.menuItemId, { name: item.name, axes: item.sensoryAxes });
    }

    // One read per DISTINCT customer, not per order.
    const names = new Map<string, string>();
    for (const order of orders) {
      if (order.customerId && !names.has(order.customerId)) {
        const c = await ctx.db.get(order.customerId);
        names.set(order.customerId, c?.name ?? "(removed)");
      }
    }

    const built = orders.map((order) => {
      const totals = totalsFor(order, linesBy.get(order._id) ?? []);
      const money = derive(totals.totalCents, paidBy.get(order._id) ?? 0);
      const depositShown =
        order.status !== "cancelled" &&
        money.paidCents === 0 &&
        (order.depositPercent ?? 0) > 0 &&
        money.balanceCents > 0;
      const askable = [
        ...new Map(
          (linesBy.get(order._id) ?? [])
            .map((l) => (l.menuItemId ? axesBy.get(l.menuItemId) && [l.menuItemId, axesBy.get(l.menuItemId)!] : null))
            .filter(Boolean) as [string, { name: string; axes: string[] }][],
        ),
      ]
        .filter(([, item]) => item.axes.length > 0)
        .map(([menuItemId, item]) => ({
          menuItemId,
          name: item.name,
          axes: item.axes,
        }));
      const feedback = feedbackBy.get(order._id) ?? { chef: 0, customer: 0 };

      return {
        id: order._id,
        /** What the one-tap sheet asks about. Empty when she has not picked
         * axes for anything on this order — the sheet still takes flags and
         * her own words. */
        feedbackItems: askable,
        feedbackCount: feedback.chef + feedback.customer,
        /** She should know not to keep waiting for the form. */
        customerReplied: feedback.customer > 0,
        /** Null until she issues a document. */
        invoiceNumber: order.invoiceNumber ?? null,
        invoiceLabel: invoiceLabel(
          order.invoicePrefixAtInvoice ?? org.invoicePrefix,
          order.invoiceNumber,
        ),
        /** Sent but never opened is the row she should chase first, so the
         * state has to be visible where the chasing happens. */
        deliveryStatus: deliveryStatusOf(order),
        /** The tiebreaker for every sort below. NOT invoiceNumber: numbers are
         * allocated when a document is issued, so ordering by one would sort
         * by the day she happened to print things, and would leave every
         * un-issued order tied at null. */
        createdAt: order._creationTime,
        customerId: order.customerId ?? null,
        customerName: order.customerId
          ? (names.get(order.customerId) ?? "(removed)")
          : "Walk-in",
        isWalkIn: order.customerId == null,
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        /** Fulfilment. Deliberately NOT called `status` alongside the
         * payment one — a single `status` field is how a screen ends up
         * printing "delivered" where it meant "paid". */
        status: order.status,
        paymentStatus: money.status,
        totalCents: money.totalCents,
        paidCents: money.paidCents,
        balanceCents: money.balanceCents,
        excessCents: money.excessCents,
        source: order.source,
        /** How long the money has been late. Null while delivery is still
         * ahead — that is a pipeline, not a debt. */
        ageDays:
          order.deliveryDate <= today ? daysBetween(order.deliveryDate, today) : null,
        depositShown,
        depositCents: depositShown
          ? Math.min(totals.depositCents, money.balanceCents)
          : 0,
      };
    });

    // The debt aggregate is over EVERY owing order, never the visible page,
    // so the Owing tab can show its total while she stands on Upcoming.
    const owing = built.filter(
      (r) =>
        r.status !== "cancelled" &&
        r.balanceCents > 0 &&
        r.deliveryDate <= today,
    );

    let rows: typeof built;
    if (filter === "upcoming") {
      rows = built
        .filter((r) => r.status === "confirmed" && r.deliveryDate >= today)
        .sort(
          (a, b) =>
            a.deliveryDate.localeCompare(b.deliveryDate) ||
            a.createdAt - b.createdAt,
        );
    } else if (filter === "owing") {
      // Oldest debt first: the money became hers the day the goods left, so
      // age is measured from the delivery date. Not the order date — a
      // January order for a June wedding is not a six-month-old debt.
      rows = [...owing].sort(
        (a, b) =>
          a.deliveryDate.localeCompare(b.deliveryDate) ||
          a.createdAt - b.createdAt,
      );
    } else {
      rows = [...built].sort(
        (a, b) =>
          b.orderDate.localeCompare(a.orderDate) ||
          b.createdAt - a.createdAt,
      );
    }

    const cap = limit ?? 50;
    return {
      rows: rows.slice(0, cap),
      hasMore: rows.length > cap,
      invoicePrefix: org.invoicePrefix,
      owedCents: owing.reduce((s, r) => s + r.balanceCents, 0),
      owingCount: owing.length,
      excessCents: built
        .filter((r) => r.status !== "cancelled")
        .reduce((s, r) => s + r.excessCents, 0),
    };
  },
});

/** Whole days between two "YYYY-MM-DD" days. Both go through the same
 * parse, so the difference is exact even though Convex runs in UTC. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86_400_000);
}

/** The chips in the quick-action drawer. */
export const quickSaleItems = orgQuery({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const sellable = items.filter((i) => !i.notSoldDirectly);
    return {
      items: sellable
        .filter((i) => i.priceCents != null)
        .map((i) => ({ id: i._id, name: i.name, priceCents: i.priceCents! }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      /** Distinguishes the two empty states, which need different next
       * actions: no menu at all → add an item; a menu with no prices →
       * price them. */
      hasMenuItems: sellable.length > 0,
    };
  },
});

/**
 * The counter sale. Two taps: the FAB, then the item.
 *
 * A full order underneath — same cost snapshot, same invoice sequence, same
 * tax stamp — but delivered and paid in the same breath, because that is
 * what actually happened at the stall.
 */
export const quickSale = orgMutation({
  args: {
    menuItemId: v.id("menuItems"),
    /** Milli-units. Defaults to one. */
    qtyMilli: v.optional(v.number()),
    /** HER local day, same reason as create. */
    day: v.string(),
    method: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = requireProvisioned(ctx.org);
    if (!DAY.test(args.day)) throw new Error("Dates need to look like 2026-08-04.");
    const qtyMilli = args.qtyMilli ?? 1000;
    if (!Number.isFinite(qtyMilli) || qtyMilli <= 0) {
      throw new Error("Every line needs a quantity.");
    }

    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    // Sub-recipe before price, matching create: a sub-recipe has no price by
    // construction, so the price message would be true and useless.
    if (item.notSoldDirectly) {
      throw new Error(`${item.name} is a sub-recipe — it isn't sold on its own.`);
    }
    if (item.priceCents == null) {
      throw new Error(`${item.name} has no price yet.`);
    }

    const world = await loadWorld(ctx);
    const costing = costItem(item._id, world);

    // A counter sale is handed over now, so "still good on the delivery day"
    // collapses to "still good today" — which is exactly what she is holding
    // out to the customer.
    const allocations = await planSellDown(ctx, {
      menuItemId: item._id,
      qtyMilli,
      deliveryInstant: endOfDayMs(args.day),
      liveSnapshot: {
        ingredientsCents: Math.round(costing.ingredients.centsPerUnit),
        perUnitExtrasCents: Math.round(costing.extras.centsPerUnit),
        overheadCents: Math.round(costing.overhead.centsPerUnit),
      },
    });

    // Totals from the SPLIT rows, not from one synthetic line: lineTotalCents
    // rounds, so round(a+b) can differ from round(a)+round(b) and the payment
    // would sit a cent under the lines forever.
    const totals = computeInvoiceTotals({
      lines: allocations.map((a) => ({
        description: item.name,
        qtyMilli: a.qtyMilli,
        unitPriceCents: item.priceCents!,
      })),
      // Hardcoded 0, never computeDeliveryFeeCents. With a flat $5 model
      // configured, running the fee helper would charge a walk-in for a
      // delivery that did not happen — and the payment would match it, so
      // the order would look correctly settled at the wrong amount.
      deliveryFeeCents: 0,
      discountCents: 0,
      tax: {
        enabled: org.taxEnabled,
        rateBp: org.taxEnabled ? org.taxRateBp : 0,
        inclusive: org.taxInclusive,
      },
      depositPercent: null,
    });

    // No number here either, and this is the case that makes the rule: a
    // counter sale is exactly the document that never gets written. It takes
    // a number only if she ever issues one (convex/invoices.ts).
    await ctx.db.patch(org._id, { taxLocked: true });

    const orderId = await ctx.db.insert("orders", {
      orgId: ctx.orgId,
      customerId: undefined,
      orderDate: args.day,
      deliveryDate: args.day,
      status: "delivered",
      deliveryFeeCents: 0,
      deliveryCostCents: 0,
      discountCents: 0,
      taxInclusiveAtCreation: org.taxInclusive,
      taxRateBpAtCreation: org.taxEnabled ? org.taxRateBp : 0,
      depositPercent: undefined,
      revision: 0,
      source: "quickSale",
      feedbackToken: `f_${crypto.randomUUID()}`,
      invoiceToken: `i_${crypto.randomUUID()}`,
    });

    // One row per origin: a unit off the shelf carries the cost stamped when
    // it was baked, not today's.
    for (const a of allocations) {
      await ctx.db.insert("orderLines", {
        orgId: ctx.orgId,
        orderId,
        menuItemId: item._id,
        qtyMilli: a.qtyMilli,
        unitPriceCents: item.priceCents,
        cogsSnapshot: a.cogsSnapshot,
        uncosted: false,
        fulfilledFromProductionLogId: a.productionLogId ?? undefined,
      });
    }
    await commitSellDown(ctx, allocations);

    // A free item is a real thing (a taster, a sample). It writes no payment
    // row — a $0 payment is not a fact — and the status ladder reports it
    // paid because the total is covered.
    const paymentId =
      totals.totalCents > 0
        ? await insertPaymentRow(ctx, {
            orderId,
            amountCents: totals.totalCents,
            method: args.method,
          })
        : null;

    return {
      orderId,
      paymentId,
      itemName: item.name,
      qtyMilli,
      totalCents: totals.totalCents,
    };
  },
});

/**
 * The ×2 / ×3 on the confirmation.
 *
 * Absolute, never relative: ×2 means "make it two", so a double tap yields
 * two and not four, and a retried request cannot compound.
 */
export const setQuickSaleQuantity = orgMutation({
  args: { orderId: v.id("orders"), qtyMilli: v.number() },
  handler: async (ctx, { orderId, qtyMilli }) => {
    if (!Number.isFinite(qtyMilli) || qtyMilli <= 0) {
      throw new Error("Every line needs a quantity.");
    }
    const order = await ctx.db.get(orderId);
    if (!order || order.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    if (order.source !== "quickSale") {
      throw new Error("That isn't a counter sale.");
    }
    if (order.status === "cancelled") throw new Error("This sale was cancelled.");
    if (Date.now() - order._creationTime > UNDO_WINDOW_MS) {
      throw new Error("That sale is no longer being adjusted.");
    }

    const lines = await ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", orderId),
      )
      .collect();
    const rows = await ctx.db
      .query("payments")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", orderId),
      )
      .collect();
    // If she has since edited the payments by hand, refuse rather than
    // silently rewrite an amount she chose. Several LINES are fine — a sale
    // served partly off the shelf is legitimately split — as long as they
    // are all the same item.
    const menuItemId = lines[0]?.menuItemId;
    if (
      lines.length === 0 ||
      !menuItemId ||
      lines.some((l) => l.menuItemId !== menuItemId) ||
      rows.length > 1
    ) {
      throw new Error("This sale has been edited — change it on the order.");
    }
    const unitPriceCents = lines[0].unitPriceCents;

    // Patching qtyMilli in place would change what was SOLD without changing
    // what was TAKEN off the shelf, so the batch would quietly disagree with
    // the sale. Put every unit back, re-plan for the new quantity, and write
    // fresh rows.
    await restoreSellDown(ctx, lines);
    for (const line of lines) await ctx.db.delete(line._id);

    const world = await loadWorld(ctx);
    const costing = costItem(menuItemId, world);
    const allocations = await planSellDown(ctx, {
      menuItemId,
      qtyMilli,
      deliveryInstant: endOfDayMs(order.deliveryDate),
      liveSnapshot: {
        ingredientsCents: Math.round(costing.ingredients.centsPerUnit),
        perUnitExtrasCents: Math.round(costing.extras.centsPerUnit),
        overheadCents: Math.round(costing.overhead.centsPerUnit),
      },
    });
    const written: Doc<"orderLines">[] = [];
    for (const a of allocations) {
      const id = await ctx.db.insert("orderLines", {
        orgId: ctx.orgId,
        orderId,
        menuItemId,
        qtyMilli: a.qtyMilli,
        unitPriceCents,
        cogsSnapshot: a.cogsSnapshot,
        uncosted: false,
        fulfilledFromProductionLogId: a.productionLogId ?? undefined,
      });
      written.push((await ctx.db.get(id))!);
    }
    await commitSellDown(ctx, allocations);

    const totals = totalsFor(order, written);
    if (rows.length === 1) {
      await ctx.db.patch(rows[0]._id, { amountCents: totals.totalCents });
    }
    return { qtyMilli, totalCents: totals.totalCents };
  },
});

/**
 * Undo, while it is still plainly the thing she just did.
 *
 * A hard delete, because a counter sale that never happened should leave no
 * trace — unlike a cancellation, which is a fact about a real order. The
 * invoice number is NOT returned to the sequence: numbers are never reused,
 * and burning one is the cheap half of that promise.
 */
export const undoQuickSale = orgMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order || order.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    if (order.source !== "quickSale") {
      // Never let this become a way to hard-delete a real sale.
      throw new Error("That isn't a counter sale.");
    }
    // Once a document has been issued, the number is spoken for. Deleting the
    // order would leave a hole in the series with nothing behind it — the
    // exact failure that allocating on materialise exists to prevent, arrived
    // at from the other direction. Cancelling stays open and leaves a void
    // invoice, which is what a void invoice is for.
    if (order.invoiceNumber != null) {
      throw new Error("An invoice was issued for this — cancel it instead.");
    }
    // The window binds the owner too. Removing a payment is reversible by
    // re-recording it; destroying an order destroys its cost snapshot.
    if (Date.now() - order._creationTime > UNDO_WINDOW_MS) {
      throw new Error("Too late to undo — cancel it on the order instead.");
    }
    const logs = await ctx.db
      .query("productionLogs")
      .withIndex("by_org_producedAt", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    if (logs.some((l) => l.orderIds.includes(orderId))) {
      throw new Error("Production was logged against this — cancel it instead.");
    }

    const lines = await ctx.db
      .query("orderLines")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", orderId),
      )
      .collect();
    // Before deleting them. A counter sale served off the shelf points
    // line → log, and the guard above only checks log.orderIds, which points
    // the other way — so without this the units would simply vanish and
    // later book as waste against a batch with no sale to show for it.
    await restoreSellDown(ctx, lines);
    for (const line of lines) await ctx.db.delete(line._id);

    const rows = await ctx.db
      .query("payments")
      .withIndex("by_org_order", (q) =>
        q.eq("orgId", ctx.orgId).eq("orderId", orderId),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);

    await ctx.db.delete(orderId);
    return null;
  },
});
