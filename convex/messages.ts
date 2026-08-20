import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ownerMutation,
  ownerQuery,
  publicQuery,
  type OrgCtx,
  type QueryCtx,
} from "./lib/functions";
import { loadReminders } from "./customers";
import {
  groupExclusions,
  partitionRecipients,
  scheduleDueOn,
  scheduleKey,
  tokensIn,
  type RecipientFacts,
} from "./lib/messages";

/**
 * The outbox. NOTHING SENDS UNATTENDED, EVER.
 *
 * That is not a preference, it is the reason this file has no scheduler in
 * it. CONTEXT.md — Comms: "Every message is drafted for approval. Nothing
 * auto-sends." The scope puts the cost in one sentence: auto-send is how a
 * customer who complained on Tuesday receives a cheery promo on Sunday.
 *
 * So a recurring schedule stores a RULE and never a draft. Whether one is due
 * is derived from that rule, her today, and what she has already answered —
 * and the recipient list resolves at the moment she opens it, which means
 * somebody who opted out this morning is already gone. A row written by a job
 * at 6am cannot manage that without a second filter at send time, and a
 * filter that has to be remembered is a filter that gets forgotten.
 *
 * The QUEUE is one `outbox` row per recipient. Twenty wa.me sends is twenty
 * rows moving `draft → approved → sent | dismissed`, so "which twelve are
 * done" is a query rather than something held in a tab that might be closed.
 * A single row with a `sentTo` array would be a read-modify-write that loses
 * a send under two racing taps — the same failure `payments.ts` refuses a
 * `paidCents` field to avoid.
 *
 * ownerQuery/ownerMutation throughout except `campaignByToken`, which is the
 * public page.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function assertDay(day: string) {
  if (!DAY.test(day)) throw new Error("Dates need to look like 2026-08-04.");
}

/**
 * A row of this kitchen's, or NOT_FOUND.
 *
 * Takes the already-fetched doc rather than an id, so it narrows the null
 * away for the caller and stays generic over every table without a cast. The
 * same NOT_FOUND for "someone else's" and "does not exist": a wrong org must
 * be indistinguishable from a wrong id (CONTEXT.md — Access).
 */
function mine<T extends { orgId: string }>(row: T | null, orgId: string): T {
  if (!row || row.orgId !== orgId) {
    throw new ConvexError({ code: "NOT_FOUND" as const });
  }
  return row;
}

// --- Recipients -----------------------------------------------------------

/**
 * Everyone she could write to, with the facts the tokens need.
 *
 * `balanceCents` is summed from payments the same way `orders.list` does, so
 * "{balance}" in a template and the figure on the orders screen cannot
 * disagree. A customer with no orders owes zero — a real number, not an
 * absence.
 */
async function recipientFacts(
  ctx: QueryCtx & OrgCtx,
): Promise<RecipientFacts[]> {
  const customers = await ctx.db
    .query("customers")
    .withIndex("by_org_name", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  if (customers.length === 0) return [];

  const orders = (
    await ctx.db
      .query("orders")
      .withIndex("by_org_deliveryDate", (q) => q.eq("orgId", ctx.orgId))
      .collect()
  ).filter((o) => o.status !== "cancelled" && o.customerId);

  const lines = await ctx.db
    .query("orderLines")
    .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  const linesByOrder = new Map<string, Doc<"orderLines">[]>();
  for (const line of lines) {
    const bucket = linesByOrder.get(line.orderId);
    if (bucket) bucket.push(line);
    else linesByOrder.set(line.orderId, [line]);
  }

  const payments = await ctx.db
    .query("payments")
    .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  const paidByOrder = new Map<string, number>();
  for (const p of payments) {
    paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) + p.amountCents);
  }

  const itemNames = new Map<string, string>();
  const lastOrder = new Map<string, { day: string; orderId: string }>();
  const owed = new Map<string, number>();

  for (const order of orders) {
    const cid = order.customerId!;
    const seen = lastOrder.get(cid);
    if (!seen || order.deliveryDate > seen.day) {
      lastOrder.set(cid, { day: order.deliveryDate, orderId: order._id });
    }
    const orderLines = linesByOrder.get(order._id) ?? [];
    const total =
      orderLines.reduce(
        (sum, l) => sum + Math.round((l.qtyMilli * l.unitPriceCents) / 1000),
        0,
      ) +
      order.deliveryFeeCents -
      order.discountCents;
    const balance = total - (paidByOrder.get(order._id) ?? 0);
    // Only what is still OWED. An overpaid order does not reduce what another
    // one is short by.
    if (balance > 0) owed.set(cid, (owed.get(cid) ?? 0) + balance);
  }

  for (const [, last] of lastOrder) {
    for (const line of linesByOrder.get(last.orderId) ?? []) {
      if (line.menuItemId && !itemNames.has(line.menuItemId)) {
        const item = await ctx.db.get(line.menuItemId);
        if (item) itemNames.set(line.menuItemId, item.name);
      }
    }
  }

  return customers.map((c) => {
    const last = lastOrder.get(c._id);
    const firstLine = last ? (linesByOrder.get(last.orderId) ?? [])[0] : undefined;
    const lastItemName = firstLine
      ? (firstLine.menuItemId ? (itemNames.get(firstLine.menuItemId) ?? null) : (firstLine.description ?? null))
      : null;
    return {
      customerId: c._id,
      name: c.name,
      phone: c.phone || null,
      email: c.email ?? null,
      // Read here and gated inside partitionRecipients, so no caller can
      // assemble a recipient list without it.
      marketingConsent: c.marketingConsent,
      lastItemName,
      balanceCents: owed.get(c._id) ?? 0,
    };
  });
}

// --- Templates ------------------------------------------------------------

export const templates = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("messageTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    return rows
      .map((t) => ({
        id: t._id,
        name: t.name,
        channel: t.channel,
        body: t.body,
        subject: t.subject ?? null,
        /** So the editor can mark them without re-parsing. */
        tokens: tokensIn(t.body),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const saveTemplate = ownerMutation({
  args: {
    templateId: v.optional(v.id("messageTemplates")),
    name: v.string(),
    channel: v.union(v.literal("whatsapp"), v.literal("email")),
    body: v.string(),
    subject: v.optional(v.string()),
  },
  handler: async (ctx, { templateId, name, channel, body, subject }) => {
    const trimmedName = name.trim();
    const trimmedBody = body.trim();
    if (trimmedName === "") throw new Error("A template needs a name.");
    if (trimmedBody === "") throw new Error("A template needs something to say.");
    const patch = {
      name: trimmedName,
      channel,
      body: trimmedBody,
      // WhatsApp has no subject line, so one stored against a WhatsApp
      // template would be a field that silently never renders.
      subject: channel === "email" ? subject?.trim() || undefined : undefined,
    };
    if (templateId) {
      mine(await ctx.db.get(templateId), ctx.orgId);
      await ctx.db.patch(templateId, patch);
      return templateId;
    }
    return await ctx.db.insert("messageTemplates", { orgId: ctx.orgId, ...patch });
  },
});

export const removeTemplate = ownerMutation({
  args: { templateId: v.id("messageTemplates") },
  handler: async (ctx, { templateId }) => {
    mine(await ctx.db.get(templateId), ctx.orgId);
    // Any schedule pointing at it goes too — a rule with no words is a rule
    // that would throw on the Sunday she needed it.
    const schedules = await ctx.db
      .query("messageSchedules")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    for (const s of schedules) {
      if (s.templateId === templateId) await ctx.db.delete(s._id);
    }
    await ctx.db.delete(templateId);
    return null;
  },
});

/**
 * The live preview: one body against one real contact.
 *
 * Against a REAL contact rather than invented placeholders, because the whole
 * question she is asking is "does this read right for an actual person" — and
 * a preview built from "Jane Doe / Cake / $10.00" cannot answer it. It also
 * shows her the exclusion count, so a template that would drop a third of the
 * list says so while she is still writing it.
 */
export const preview = ownerQuery({
  args: {
    body: v.string(),
    channel: v.union(v.literal("whatsapp"), v.literal("email")),
    customerId: v.optional(v.id("customers")),
    messageDate: v.optional(v.string()),
  },
  handler: async (ctx, { body, channel, customerId, messageDate }) => {
    const facts = await recipientFacts(ctx);
    const { sending, excluded } = partitionRecipients(
      facts,
      body,
      channel,
      messageDate ?? null,
    );

    const chosen = customerId
      ? facts.find((f) => f.customerId === customerId)
      : (facts.find((f) => f.marketingConsent) ?? facts[0]);
    const one = chosen
      ? partitionRecipients([chosen], body, channel, messageDate ?? null)
      : { sending: [], excluded: [] };

    return {
      tokens: tokensIn(body),
      contacts: facts.map((f) => ({ id: f.customerId, name: f.name })),
      previewFor: chosen ? { id: chosen.customerId, name: chosen.name } : null,
      /** Null when this very contact would be excluded — the panel then says
       * why instead of showing a message that will not go. */
      previewText: one.sending[0]?.body ?? null,
      previewExcluded: one.excluded[0]?.reason ?? null,
      sendingCount: sending.length,
      totalCount: facts.length,
      exclusions: groupExclusions(excluded),
    };
  },
});

// --- Recurring schedules --------------------------------------------------

export const schedules = ownerQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    assertDay(today);
    const rows = await ctx.db
      .query("messageSchedules")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const answered = await answeredScheduleKeys(ctx);
    const names = new Map(
      (
        await ctx.db
          .query("messageTemplates")
          .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
          .collect()
      ).map((t) => [t._id as string, t.name]),
    );
    return rows.map((s) => ({
      id: s._id,
      templateId: s.templateId,
      templateName: names.get(s.templateId) ?? "(removed)",
      weekday: s.weekday,
      audience: s.audience,
      active: s.active,
      dueToday: scheduleDueOn(
        { id: s._id, weekday: s.weekday, active: s.active },
        today,
        answered,
      ),
    }));
  },
});

export const saveSchedule = ownerMutation({
  args: {
    scheduleId: v.optional(v.id("messageSchedules")),
    templateId: v.id("messageTemplates"),
    weekday: v.number(),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { scheduleId, templateId, weekday, active }) => {
    mine(await ctx.db.get(templateId), ctx.orgId);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new Error("A weekday has to be 0 to 6.");
    }
    if (scheduleId) {
      mine(await ctx.db.get(scheduleId), ctx.orgId);
      await ctx.db.patch(scheduleId, {
        templateId,
        weekday,
        ...(active === undefined ? {} : { active }),
      });
      return scheduleId;
    }
    return await ctx.db.insert("messageSchedules", {
      orgId: ctx.orgId,
      templateId,
      weekday,
      audience: "allConsenting",
      active: active ?? true,
    });
  },
});

export const removeSchedule = ownerMutation({
  args: { scheduleId: v.id("messageSchedules") },
  handler: async (ctx, { scheduleId }) => {
    mine(await ctx.db.get(scheduleId), ctx.orgId);
    await ctx.db.delete(scheduleId);
    return null;
  },
});

async function answeredScheduleKeys(
  ctx: QueryCtx & OrgCtx,
): Promise<Set<string>> {
  const rows = await ctx.db
    .query("outbox")
    .withIndex("by_org_scheduleKey", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  return new Set(
    rows.map((r) => r.scheduleKey).filter((k): k is string => Boolean(k)),
  );
}

// --- The outbox -----------------------------------------------------------

/**
 * Everything waiting for her: a batch in progress, the recurring drafts due
 * today, and the reorder reminders from 8.1.
 *
 * The reminders come from `loadReminders` — the helper the customers slice
 * exported for exactly this, with the comment "must not derive it a second
 * way". Two screens disagreeing about who to contact is worse than either
 * being wrong alone.
 */
export const outbox = ownerQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    assertDay(today);

    const pending = (
      await ctx.db
        .query("outbox")
        .withIndex("by_org_status", (q) => q.eq("orgId", ctx.orgId).eq("status", "draft"))
        .collect()
    ).concat(
      await ctx.db
        .query("outbox")
        .withIndex("by_org_status", (q) => q.eq("orgId", ctx.orgId).eq("status", "approved"))
        .collect(),
    );

    const names = new Map<string, string>();
    for (const row of pending) {
      for (const id of row.recipientIds) {
        if (names.has(id)) continue;
        const c = await ctx.db.get(id);
        names.set(id, c?.name ?? "(removed)");
      }
    }
    const phones = new Map<string, string | null>();
    const emails = new Map<string, string | null>();
    for (const row of pending) {
      for (const id of row.recipientIds) {
        if (phones.has(id)) continue;
        const c = await ctx.db.get(id);
        phones.set(id, c?.phone ?? null);
        emails.set(id, c?.email ?? null);
      }
    }

    const queue = pending
      .map((row) => ({
        id: row._id,
        campaignId: row.campaignId ?? null,
        channel: row.channel,
        body: row.body,
        // One recipient per row — see the file header.
        customerId: row.recipientIds[0] ?? null,
        customerName: row.recipientIds[0] ? (names.get(row.recipientIds[0]) ?? "") : "",
        phone: row.recipientIds[0] ? (phones.get(row.recipientIds[0]) ?? null) : null,
        email: row.recipientIds[0] ? (emails.get(row.recipientIds[0]) ?? null) : null,
        /** `approved` with an `openedAt` is one she tapped through and has
         * not answered yet — the state a reload has to come back to. */
        opened: row.status === "approved",
        openedAt: row.openedAt ?? null,
      }))
      // Stable by name so a reload lands on the same row rather than a
      // reshuffled list.
      .sort((a, b) => a.customerName.localeCompare(b.customerName));

    const answered = await answeredScheduleKeys(ctx);
    const scheduleRows = await ctx.db
      .query("messageSchedules")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const templates = new Map(
      (
        await ctx.db
          .query("messageTemplates")
          .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
          .collect()
      ).map((t) => [t._id as string, t]),
    );

    const dueDrafts = scheduleRows
      .filter((s) =>
        scheduleDueOn({ id: s._id, weekday: s.weekday, active: s.active }, today, answered),
      )
      .map((s) => {
        const template = templates.get(s.templateId);
        return {
          scheduleId: s._id,
          key: scheduleKey(s._id, today),
          templateId: s.templateId,
          templateName: template?.name ?? "(removed)",
          channel: template?.channel ?? "whatsapp",
          body: template?.body ?? "",
          subject: template?.subject ?? null,
        };
      })
      .filter((d) => d.body !== "");

    return {
      today,
      queue,
      dueDrafts,
      reminders: await loadReminders(ctx, today),
      doneToday: (
        await ctx.db
          .query("outbox")
          .withIndex("by_org_status", (q) => q.eq("orgId", ctx.orgId).eq("status", "sent"))
          .collect()
      ).filter((r) => r.sentAt !== undefined && r.sentAt >= Date.parse(`${today}T00:00:00Z`))
        .length,
    };
  },
});

/**
 * Start a batch: one row per recipient who is actually getting it.
 *
 * The exclusions never become rows. A row for somebody who opted out would be
 * a thing sitting in her queue asking to be sent, which is the one shape this
 * whole file exists to prevent.
 */
export const startBatch = ownerMutation({
  args: {
    body: v.string(),
    channel: v.union(v.literal("whatsapp"), v.literal("email")),
    templateId: v.optional(v.id("messageTemplates")),
    scheduleKey: v.optional(v.string()),
    campaignId: v.optional(v.id("campaigns")),
    messageDate: v.optional(v.string()),
    /** Absent means everyone. Present narrows it — she can still cut the
     * list, she just cannot add somebody consent excluded. */
    onlyCustomerIds: v.optional(v.array(v.id("customers"))),
  },
  handler: async (ctx, args) => {
    const body = args.body.trim();
    if (body === "") throw new Error("There is nothing to send.");

    let facts = await recipientFacts(ctx);
    if (args.onlyCustomerIds) {
      const chosen = new Set<string>(args.onlyCustomerIds);
      facts = facts.filter((f) => chosen.has(f.customerId));
    }
    const { sending, excluded } = partitionRecipients(
      facts,
      body,
      args.channel,
      args.messageDate ?? null,
    );
    if (sending.length === 0) {
      throw new Error("Nobody on that list can be sent this message.");
    }

    const ids: Id<"outbox">[] = [];
    for (const one of sending) {
      ids.push(
        await ctx.db.insert("outbox", {
          orgId: ctx.orgId,
          templateId: args.templateId,
          recipientIds: [one.customerId as Id<"customers">],
          channel: args.channel,
          // Already filled, per recipient. Nothing downstream re-renders it,
          // so what she approved is what goes.
          body: one.body,
          status: "draft",
          ...(args.scheduleKey ? { scheduleKey: args.scheduleKey } : {}),
          ...(args.campaignId ? { campaignId: args.campaignId } : {}),
        }),
      );
    }
    return { created: ids.length, excluded: excluded.length };
  },
});

/** She tapped through to WhatsApp. The row is now waiting on her answer. */
export const markOpened = ownerMutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const row = mine(await ctx.db.get(outboxId), ctx.orgId);
    if (row.status !== "draft") return null;
    await ctx.db.patch(outboxId, { status: "approved", openedAt: Date.now() });
    return null;
  },
});

/**
 * She says she sent it. HER word — Sous never sends anything itself, so
 * "sent" is a report rather than a claim by the system (CONTEXT.md — Comms).
 */
export const markSent = ownerMutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const row = mine(await ctx.db.get(outboxId), ctx.orgId);
    // Idempotent: two taps, or a retry after a flaky connection. The outcome
    // she wanted is already true.
    if (row.status === "sent") return null;
    await ctx.db.patch(outboxId, { status: "sent", sentAt: Date.now() });
    return null;
  },
});

/**
 * Everything the email route needs to send ONE row, and nothing else.
 *
 * The route is in Next rather than Convex for the reason `convex/lib/
 * functions.ts` makes structural: there is no action wrapper in this codebase
 * and Resend cannot be reached from a query or a mutation. So the handler
 * reads this through the caller's own JWT and can see exactly what she can.
 *
 * `to` comes from the customer row and NEVER from the request body. A route
 * that accepted a recipient from the browser would be a spam relay wearing
 * her domain's reputation — the same reasoning `invoices.deliveryPayload`
 * carries, and the reason both return the address rather than take one.
 */
export const sendPayload = ownerQuery({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const row = mine(await ctx.db.get(outboxId), ctx.orgId);
    if (row.channel !== "email") {
      // WhatsApp never comes through here: it is a wa.me link she taps, with
      // no server in the path at all.
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const customerId = row.recipientIds[0] ?? null;
    const customer = customerId ? await ctx.db.get(customerId) : null;
    const campaign = row.campaignId ? await ctx.db.get(row.campaignId) : null;
    const template = row.templateId ? await ctx.db.get(row.templateId) : null;

    return {
      to: customer?.email ?? null,
      customerName: customer?.name ?? null,
      orgName: ctx.org?.name ?? "",
      /** Resend sends from a Sous domain; a reply has to reach HER. */
      replyTo: ctx.org?.replyTo ?? ctx.org?.email ?? null,
      subject: campaign?.subject ?? template?.subject ?? null,
      body: row.body,
      alreadySent: row.status === "sent",
      /** The campaign flyer, if this row belongs to one. A URL rather than
       * bytes: a query cannot stream a file, and the route is already making
       * network calls. */
      attachmentUrl: campaign?.fileId
        ? await ctx.storage.getUrl(campaign.fileId)
        : null,
      attachmentName: campaign ? `${slugFilename(campaign.name)}.pdf` : null,
    };
  },
});

/** A filename a stranger's phone will accept: her campaign name, stripped to
 * the characters every OS agrees on. */
function slugFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "menu" : slug.slice(0, 60);
}

/** She opened it and thought better of it. */
export const markSkipped = ownerMutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const row = mine(await ctx.db.get(outboxId), ctx.orgId);
    if (row.status === "dismissed") return null;
    await ctx.db.patch(outboxId, { status: "dismissed" });
    return null;
  },
});

/** A recurring draft she does not want this week. Records the answer without
 * creating twenty rows first. */
export const dismissDue = ownerMutation({
  args: { scheduleKey: v.string(), body: v.string() },
  handler: async (ctx, { scheduleKey: key, body }) => {
    const existing = await ctx.db
      .query("outbox")
      .withIndex("by_org_scheduleKey", (q) =>
        q.eq("orgId", ctx.orgId).eq("scheduleKey", key),
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("outbox", {
      orgId: ctx.orgId,
      recipientIds: [],
      channel: "whatsapp",
      body: body.trim(),
      status: "dismissed",
      scheduleKey: key,
    });
  },
});

// --- Campaigns ------------------------------------------------------------

export const createCampaign = ownerMutation({
  args: {
    name: v.string(),
    channel: v.union(v.literal("whatsapp"), v.literal("email")),
    body: v.string(),
    subject: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    onlyCustomerIds: v.optional(v.array(v.id("customers"))),
    messageDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    const body = args.body.trim();
    if (name === "") throw new Error("A campaign needs a name.");
    if (body === "") throw new Error("A campaign needs something to say.");

    let facts = await recipientFacts(ctx);
    if (args.onlyCustomerIds) {
      const chosen = new Set<string>(args.onlyCustomerIds);
      facts = facts.filter((f) => chosen.has(f.customerId));
    }
    const { sending } = partitionRecipients(
      facts,
      body,
      args.channel,
      args.messageDate ?? null,
    );
    if (sending.length === 0) {
      throw new Error("Nobody on that list can be sent this campaign.");
    }

    const campaignId = await ctx.db.insert("campaigns", {
      orgId: ctx.orgId,
      name,
      channel: args.channel,
      body,
      subject: args.channel === "email" ? args.subject?.trim() || undefined : undefined,
      fileId: args.fileId,
      recipientIds: sending.map((s) => s.customerId as Id<"customers">),
      token: `c_${crypto.randomUUID()}`,
    });

    for (const one of sending) {
      await ctx.db.insert("outbox", {
        orgId: ctx.orgId,
        recipientIds: [one.customerId as Id<"customers">],
        channel: args.channel,
        body: one.body,
        status: "draft",
        campaignId,
      });
    }
    return { campaignId, recipients: sending.length };
  },
});

export const campaignHistory = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("campaigns")
      .withIndex("by_org_sentAt", (q) => q.eq("orgId", ctx.orgId))
      .order("desc")
      .take(50);
    const out = [];
    for (const c of rows) {
      const queued = await ctx.db
        .query("outbox")
        .withIndex("by_org_campaign", (q) =>
          q.eq("orgId", ctx.orgId).eq("campaignId", c._id),
        )
        .collect();
      out.push({
        id: c._id,
        name: c.name,
        channel: c.channel,
        token: c.token,
        recipients: c.recipientIds.length,
        sent: queued.filter((r) => r.status === "sent").length,
        skipped: queued.filter((r) => r.status === "dismissed").length,
        hasFile: c.fileId !== undefined,
        createdAt: c._creationTime,
        sentAt: c.sentAt ?? null,
      });
    }
    return out;
  },
});

/** Burn a link that went somewhere she did not intend. The campaign and its
 * history survive; only the URL changes. */
export const replaceCampaignToken = ownerMutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    mine(await ctx.db.get(campaignId), ctx.orgId);
    const token = `c_${crypto.randomUUID()}`;
    await ctx.db.patch(campaignId, { token });
    return token;
  },
});

/**
 * The public campaign page — `/c/[token]`.
 *
 * A `publicQuery`, which is the same shape `invoices.byToken` takes and for
 * the same reason: this link goes into an Instagram story, so it is
 * unauthenticated by design and scoped by an unguessable token instead of a
 * session. It is a QUERY and never a mutation — nothing a visitor sends is
 * stored, and there is no counter to poison.
 *
 * Returns only what a stranger should see: her name, her logo, the campaign
 * name and the file. Never the recipient list.
 */
export const campaignByToken = publicQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    // Cheap shape check first, so an invoice token pasted here fails before
    // an index scan.
    if (!token.startsWith("c_")) return null;
    const campaign = await ctx.db
      .query("campaigns")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!campaign) return null;

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_orgId", (q) => q.eq("orgId", campaign.orgId))
      .unique();
    if (!org) return null;

    return {
      kitchenName: org.name,
      logoUrl: org.logo ? await ctx.storage.getUrl(org.logo) : null,
      palette: org.palette,
      name: campaign.name,
      body: campaign.body,
      fileUrl: campaign.fileId ? await ctx.storage.getUrl(campaign.fileId) : null,
    };
  },
});
