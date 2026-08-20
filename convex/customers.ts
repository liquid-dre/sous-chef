import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ownerMutation,
  ownerQuery,
  type OrgCtx,
  type QueryCtx,
} from "./lib/functions";
import { pnlFor, requireProvisioned } from "./dashboard";
import { rankCustomers, rankOrders, type PnlOrder } from "./lib/pnl";
import {
  dueReminders,
  occasionMix,
  repeatSplit,
  type Occasion,
  type OrderFact,
  type Reminder,
} from "./lib/contacts";

/**
 * The contact list, which builds itself from orders.
 *
 * Everything this slice needs was already in the schema and none of it was
 * ever read. `marketingConsent` and `consentSource` have been written once at
 * `orders.ts:191-192` since the order form shipped and consulted by nothing;
 * `notes` was never read OR written. The schema's own comment promises
 * "the mutation refuses to flip it back on" — this file is that mutation
 * finally existing.
 *
 * Two rules shape it.
 *
 * 1. **Profitability is not recomputed here.** The acceptance criterion is
 *    explicit and the reason is stronger than tidiness: `insights/customers`
 *    already shows a profit figure per customer, and a second implementation
 *    would eventually disagree with it about the same person. So this calls
 *    `pnlFor` → `rankCustomers` — the identical path `dashboard.breakdown`
 *    takes — and convex/customers.test.ts asserts the two are byte-identical.
 * 2. **Reminders are derived, never stored.** A customer who opts out or who
 *    simply orders again vanishes from the next read with nothing needing to
 *    have run. That is what makes "immediately and permanently" a property of
 *    the design rather than a promise about a cleanup job. Only what SHE did
 *    about a reminder is written down.
 *
 * ownerQuery/ownerMutation throughout: the route is already `ownerOnly` and
 * every figure here is profit.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function assertDay(day: string) {
  if (!DAY.test(day)) throw new Error("Dates need to look like 2026-08-04.");
}

// --- Reminders ------------------------------------------------------------

/**
 * Everything the reminder engine needs, read once.
 *
 * Exported because 8.2's Messages outbox will want exactly this list and
 * must not derive it a second way — two screens disagreeing about who to
 * contact is worse than either being wrong on its own.
 */
export async function loadReminders(
  ctx: QueryCtx & OrgCtx,
  today: string,
): Promise<Reminder[]> {
  // EVERY order with a customer, including ones carrying no occasion chip.
  // Filtering to chipped orders here would starve the engine's third gate:
  // "have they already been back" is answered from the most recent order of
  // ANY kind, and a reorder she did not tag would otherwise be invisible —
  // so Sous would tell her to chase a customer she already has.
  const orders = (
    await ctx.db
      .query("orders")
      .withIndex("by_org_deliveryDate", (q) => q.eq("orgId", ctx.orgId))
      .collect()
  ).filter((o) => o.status !== "cancelled" && o.customerId);
  if (orders.length === 0) return [];

  const customers = new Map<string, Doc<"customers">>();
  for (const order of orders) {
    const id = order.customerId!;
    if (customers.has(id)) continue;
    const row = await ctx.db.get(id);
    if (row) customers.set(id, row);
  }

  const items = new Map<string, Doc<"menuItems">>();
  const allLines = await ctx.db
    .query("orderLines")
    .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  const firstLineOf = new Map<string, Doc<"orderLines">>();
  for (const line of allLines) {
    if (!firstLineOf.has(line.orderId)) firstLineOf.set(line.orderId, line);
    if (line.menuItemId && !items.has(line.menuItemId)) {
      const item = await ctx.db.get(line.menuItemId);
      if (item) items.set(line.menuItemId, item);
    }
  }

  const facts: OrderFact[] = [];
  for (const order of orders) {
    const customer = customers.get(order.customerId!);
    if (!customer) continue;
    const line = firstLineOf.get(order._id);
    const item = line?.menuItemId ? items.get(line.menuItemId) : undefined;
    facts.push({
      orderId: order._id,
      customerId: customer._id,
      customerName: customer.name,
      phone: customer.phone,
      // Read here and gated inside dueReminders, so no caller can forget.
      marketingConsent: customer.marketingConsent,
      deliveryDate: order.deliveryDate,
      occasion: (order.occasion ?? null) as Occasion | null,
      itemName: item?.name ?? line?.description ?? null,
      leadTimeHours: item?.leadTimeHours ?? null,
    });
  }

  // What she has already dealt with. Only rows carrying a key are ours;
  // 8.2's campaigns will share the table without colliding.
  const handled = await ctx.db
    .query("outbox")
    .withIndex("by_org_reminderKey", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  const suppressed = new Set(
    handled.map((row) => row.reminderKey).filter((k): k is string => Boolean(k)),
  );

  return dueReminders(facts, today, suppressed);
}

// --- The list -------------------------------------------------------------

export interface ContactRow {
  id: Id<"customers">;
  name: string;
  phone: string;
  email: string | null;
  marketingConsent: boolean;
  optedOut: boolean;
  /** LIFETIME, not period — a contact is a person, and a person is
   * cumulative. Same computation as the dashboard, unbounded window. */
  orders: number;
  lifetimeRevenueCents: number;
  lifetimeProfitCents: number;
  marginPercent: number | null;
  lastOrderedOn: string | null;
}

export const list = ownerQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    assertDay(today);
    const org = requireProvisioned(ctx.org);

    // Unbounded start — `lib/period.ts` already models this as the "all"
    // case, and lifetime value is exactly that. The SAME call the dashboard
    // makes, with a wider window.
    const { input } = await pnlFor(ctx, org, undefined, today);
    const byCustomer = new Map(
      rankCustomers(input.orders)
        .filter((c) => c.customerId !== null)
        .map((c) => [c.customerId!, c]),
    );

    const lastOrderOn = new Map<string, string>();
    for (const order of input.orders) {
      if (!order.customerId) continue;
      const seen = lastOrderOn.get(order.customerId);
      if (!seen || order.deliveryDate > seen) {
        lastOrderOn.set(order.customerId, order.deliveryDate);
      }
    }

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_org_name", (q) => q.eq("orgId", ctx.orgId))
      .collect();

    const rows: ContactRow[] = customers.map((c) => {
      const money = byCustomer.get(c._id);
      return {
        id: c._id,
        name: c.name,
        phone: c.phone,
        email: c.email ?? null,
        marketingConsent: c.marketingConsent,
        optedOut: c.consentSource === "optedOut",
        orders: money?.orders ?? 0,
        lifetimeRevenueCents: money?.revenueCents ?? 0,
        lifetimeProfitCents: money?.profitCents ?? 0,
        marginPercent: money?.marginPercent ?? null,
        lastOrderedOn: lastOrderOn.get(c._id) ?? null,
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return {
      rows,
      reminders: await loadReminders(ctx, today),
      optedOutCount: rows.filter((r) => r.optedOut).length,
    };
  },
});

export const get = ownerQuery({
  args: { customerId: v.id("customers"), today: v.string() },
  handler: async (ctx, { customerId, today }) => {
    assertDay(today);
    const org = requireProvisioned(ctx.org);
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }

    const { input } = await pnlFor(ctx, org, undefined, today);
    const money = rankCustomers(input.orders).find((c) => c.customerId === customerId);
    const perOrder = new Map(rankOrders(input.orders).map((o) => [o.orderId, o]));

    const history = input.orders
      .filter((o) => o.customerId === customerId)
      .map((o) => {
        const row = perOrder.get(o.id);
        return {
          orderId: o.id as Id<"orders">,
          deliveryDate: o.deliveryDate,
          occasion: (o.occasion ?? null) as Occasion | null,
          revenueCents: row?.revenueCents ?? 0,
          profitCents: row?.profitCents ?? 0,
          /** Why this one was thin, in her words — already computed by
           * rankOrders and dropped by rankCustomers. */
          reason: row?.reason ?? null,
        };
      })
      .sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));

    const occasions = occasionMix(
      input.orders.filter((o) => o.customerId === customerId),
      (o) => perOrder.get(o.id)?.revenueCents ?? 0,
    );

    return {
      id: customer._id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email ?? null,
      address: customer.address ?? null,
      notes: customer.notes ?? null,
      marketingConsent: customer.marketingConsent,
      optedOut: customer.consentSource === "optedOut",
      consentSource: customer.consentSource,
      orders: money?.orders ?? 0,
      lifetimeRevenueCents: money?.revenueCents ?? 0,
      lifetimeProfitCents: money?.profitCents ?? 0,
      marginPercent: money?.marginPercent ?? null,
      history,
      occasions,
      reminders: (await loadReminders(ctx, today)).filter(
        (r) => r.customerId === customerId,
      ),
    };
  },
});

// --- Consent --------------------------------------------------------------

/**
 * Opting out. ONE WAY, and the mutation is where that is enforced.
 *
 * CONTEXT.md calls it "one-tap permanent global opt-out", and POPIA and
 * Zimbabwe's Data Protection Act both put the same shape on it: withdrawal
 * must be easy, and re-consent has to come from the customer rather than from
 * the business. So there is no `optIn` here and no boolean argument — a
 * function that could take `false` could take `true`, and the whole point is
 * that this one cannot.
 *
 * `orders.create` already knows: its comment at `:177-178` says "opting out
 * is permanent, so consent is never flipped back on by a later order", and it
 * patches only email and address on a returning customer. This closes the
 * other door.
 */
export const optOut = ownerMutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, { customerId }) => {
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    // Idempotent rather than an error: she tapped it twice, or two devices
    // raced. The outcome she wanted is already true.
    if (customer.consentSource === "optedOut") return null;
    await ctx.db.patch(customerId, {
      marketingConsent: false,
      consentSource: "optedOut",
    });
    return null;
  },
});

export const setNotes = ownerMutation({
  args: { customerId: v.id("customers"), notes: v.string() },
  handler: async (ctx, { customerId, notes }) => {
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const trimmed = notes.trim();
    await ctx.db.patch(customerId, { notes: trimmed || undefined });
    return null;
  },
});

/**
 * What she did about one reminder.
 *
 * Writes an `outbox` row — the table built for exactly this and never once
 * used. `"sent"` means she opened WhatsApp; nothing in Sous ever sends on its
 * own (CONTEXT.md — Comms), so "sent" is her word, not a claim by the system.
 */
export const markReminder = ownerMutation({
  args: {
    reminderKey: v.string(),
    customerId: v.id("customers"),
    body: v.string(),
    action: v.union(v.literal("sent"), v.literal("dismissed")),
  },
  handler: async (ctx, { reminderKey, customerId, body, action }) => {
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const existing = await ctx.db
      .query("outbox")
      .withIndex("by_org_reminderKey", (q) =>
        q.eq("orgId", ctx.orgId).eq("reminderKey", reminderKey),
      )
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("outbox", {
      orgId: ctx.orgId,
      recipientIds: [customerId],
      channel: "whatsapp",
      body: body.trim(),
      status: action,
      reminderKey,
      ...(action === "sent" ? { sentAt: Date.now() } : {}),
    });
  },
});

// --- The charts -----------------------------------------------------------

/**
 * Period-bounded, unlike the contact card.
 *
 * A contact is cumulative; the business is not. "Are the reorder reminders
 * working" is only answerable across a window she can move, which is why the
 * repeat split lives here and the lifetime figure lives on `get`.
 */
export const insights = ownerQuery({
  args: { start: v.optional(v.string()), end: v.string() },
  handler: async (ctx, { start, end }) => {
    assertDay(end);
    if (start !== undefined) assertDay(start);
    const org = requireProvisioned(ctx.org);

    const { input } = await pnlFor(ctx, org, start, end);
    const perOrder = new Map(rankOrders(input.orders).map((o) => [o.orderId, o]));
    const revenueOf = (o: PnlOrder) => perOrder.get(o.id)?.revenueCents ?? 0;

    // Every order EVER, so "first time" means first time — not first inside
    // whatever window she happens to be looking at. Unbounded, and at a
    // pilot kitchen's volume that is a cheap read; if it ever runs against a
    // hundred kitchens it wants an index, not a rewrite.
    const allOrders = (
      await ctx.db
        .query("orders")
        .withIndex("by_org_deliveryDate", (q) => q.eq("orgId", ctx.orgId))
        .collect()
    ).filter((o) => o.status !== "cancelled" && o.customerId);

    const firstEver = new Map<string, { id: string; day: string }>();
    for (const order of allOrders) {
      const seen = firstEver.get(order.customerId!);
      if (
        !seen ||
        order.deliveryDate < seen.day ||
        (order.deliveryDate === seen.day && order._id < seen.id)
      ) {
        firstEver.set(order.customerId!, { id: order._id, day: order.deliveryDate });
      }
    }
    const firstOrderIds = new Set([...firstEver.values()].map((f) => f.id));

    return {
      /** Top by PROFIT, not revenue — the customer who orders most is not
       * necessarily the customer worth most, the same reframe 4.1 makes
       * about menu items. Descending here; rankCustomers sorts worst-first
       * for the "what is hurting you" screen. */
      topCustomers: rankCustomers(input.orders)
        .filter((c) => c.customerId !== null)
        .sort((a, b) => b.profitCents - a.profitCents)
        .slice(0, 10),
      repeat: repeatSplit(input.orders, firstOrderIds, revenueOf),
      occasions: occasionMix(input.orders, revenueOf),
      orderCount: input.orders.length,
    };
  },
});
