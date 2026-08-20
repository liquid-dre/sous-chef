import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * The outbox, end to end.
 *
 * The test that carries the slice is the queue surviving a reload — asserted
 * by re-reading the query from scratch rather than by poking at component
 * state, because a reload is exactly "throw the client away and ask again".
 * Twelve of twenty done has to come back as eight left, in the same order,
 * with nothing lost and nothing repeated.
 *
 * The other one that matters: a consent-excluded contact never becomes an
 * outbox row at all. A row for somebody who opted out would sit in her queue
 * asking to be sent, which is the shape this whole feature exists to prevent.
 */

const OWNER = {
  subject: "user_owner",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:admin",
};
const STAFF = { ...OWNER, subject: "user_staff", org_role: "org:member" };
const OTHER = {
  subject: "user_b",
  org_id: "org_kitchen_b",
  org_slug: "kitchen-b",
  org_role: "org:admin",
};
const SLUG = { orgSlug: "kitchen-a" };

/** 2026-08-09 is a Sunday. */
const TODAY = "2026-08-09";

async function kitchen() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  const asSuper = t.withIdentity({ subject: "user_super" });
  for (const [orgId, slug, name] of [
    ["org_kitchen_a", "kitchen-a", "Kitchen A"],
    ["org_kitchen_b", "kitchen-b", "Kitchen B"],
  ] as const) {
    await asSuper.mutation(api.admin.provisionOrg, { orgId, slug, name });
  }
  await t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
    ...SLUG,
    overheadRateCentsPerHour: 800,
    deliveryFeeModel: "flat",
    deliveryFeeConfig: { flatCents: 0 },
  });
  return t;
}

/** A customer with an order, so {item} resolves. */
async function customer(
  t: ReturnType<typeof convexTest>,
  name: string,
  phone: string,
  over: { email?: string; withOrder?: boolean } = {},
) {
  const id = await t.run(async (ctx) =>
    ctx.db.insert("customers", {
      orgId: "org_kitchen_a",
      name,
      phone,
      email: over.email,
      marketingConsent: true,
      consentSource: "order" as const,
    }),
  );
  if (over.withOrder !== false) {
    await t.run(async (ctx) => {
      const orderId = await ctx.db.insert("orders", {
        orgId: "org_kitchen_a",
        customerId: id,
        orderDate: "2026-07-01",
        deliveryDate: "2026-07-01",
        status: "delivered" as const,
        deliveryFeeCents: 0,
        deliveryCostCents: 0,
        discountCents: 0,
        taxRateBpAtCreation: 0,
        taxInclusiveAtCreation: false,
        revision: 0,
        source: "app" as const,
        feedbackToken: `f_${name}`,
        invoiceToken: `i_${name}`,
      });
      await ctx.db.insert("orderLines", {
        orgId: "org_kitchen_a",
        orderId,
        description: "Chocolate cake",
        qtyMilli: 1_000,
        unitPriceCents: 4_000,
        uncosted: true,
      });
    });
  }
  return id;
}

const asOwner = (t: ReturnType<typeof convexTest>) => t.withIdentity(OWNER);
const readOutbox = (t: ReturnType<typeof convexTest>, today = TODAY) =>
  asOwner(t).query(api.messages.outbox, { ...SLUG, today });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00Z`));
  vi.unstubAllEnvs();
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
});
afterEach(() => vi.useRealTimers());

describe("templates", () => {
  test("saving, listing, and the tokens it uses", async () => {
    const t = await kitchen();
    await asOwner(t).mutation(api.messages.saveTemplate, {
      ...SLUG,
      name: "Taking orders",
      channel: "whatsapp",
      body: "Hi {name}, taking orders for {date}.",
    });
    const rows = await asOwner(t).query(api.messages.templates, SLUG);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Taking orders");
    expect(rows[0].tokens).toEqual(["name", "date"]);
  });

  test("a WhatsApp template cannot carry a subject line", async () => {
    // WhatsApp has none, so a stored subject would be a field that silently
    // never renders.
    const t = await kitchen();
    await asOwner(t).mutation(api.messages.saveTemplate, {
      ...SLUG,
      name: "Hello",
      channel: "whatsapp",
      body: "Hi {name}.",
      subject: "Ignored",
    });
    expect((await asOwner(t).query(api.messages.templates, SLUG))[0].subject).toBeNull();
  });

  test("an empty body is refused rather than saved", async () => {
    const t = await kitchen();
    await expect(
      asOwner(t).mutation(api.messages.saveTemplate, {
        ...SLUG,
        name: "Blank",
        channel: "whatsapp",
        body: "   ",
      }),
    ).rejects.toThrow(/something to say/);
  });

  test("removing a template takes its schedules with it", async () => {
    // A rule with no words would throw on the Sunday she needed it.
    const t = await kitchen();
    const templateId = await asOwner(t).mutation(api.messages.saveTemplate, {
      ...SLUG,
      name: "Weekly",
      channel: "whatsapp",
      body: "Hi {name}.",
    });
    await asOwner(t).mutation(api.messages.saveSchedule, {
      ...SLUG,
      templateId,
      weekday: 0,
    });
    expect(await asOwner(t).query(api.messages.schedules, { ...SLUG, today: TODAY })).toHaveLength(1);

    await asOwner(t).mutation(api.messages.removeTemplate, { ...SLUG, templateId });
    expect(await asOwner(t).query(api.messages.schedules, { ...SLUG, today: TODAY })).toHaveLength(0);
  });
});

describe("the preview", () => {
  test("renders against a real contact and counts the exclusions", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    const chipo = await customer(t, "Chipo", "+263772119003");
    await asOwner(t).mutation(api.customers.optOut, { ...SLUG, customerId: chipo });

    const preview = await asOwner(t).query(api.messages.preview, {
      ...SLUG,
      body: "Hi {name}, your {item} is ready.",
      channel: "whatsapp",
    });
    expect(preview.previewText).toBe("Hi Andre, your Chocolate cake is ready.");
    expect(preview.sendingCount).toBe(1);
    expect(preview.totalCount).toBe(2);
    expect(preview.exclusions).toEqual([
      { label: "opted out of marketing", names: ["Chipo"] },
    ]);
  });

  test("previewing an excluded contact says why rather than showing a message", async () => {
    const t = await kitchen();
    const rudo = await customer(t, "Rudo", "+263771234567", { withOrder: false });
    const preview = await asOwner(t).query(api.messages.preview, {
      ...SLUG,
      body: "Hi {name}, your {item} is ready.",
      channel: "whatsapp",
      customerId: rudo,
    });
    expect(preview.previewText).toBeNull();
    expect(preview.previewExcluded).toEqual({ kind: "unfillable", tokens: ["item"] });
  });
});

describe("the queue", () => {
  /** Five consenting contacts with orders, so {item} resolves for all. */
  async function five(t: ReturnType<typeof convexTest>) {
    const names = ["Andre", "Betty", "Chipo", "Dora", "Enock"];
    for (const [i, name] of names.entries()) {
      await customer(t, name, `+26371555018${i}`);
    }
  }

  test("ACCEPTANCE: the queue survives a reload mid-batch", async () => {
    const t = await kitchen();
    await five(t);

    const started = await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}, taking orders.",
      channel: "whatsapp",
    });
    expect(started.created).toBe(5);

    const before = await readOutbox(t);
    expect(before.queue).toHaveLength(5);
    expect(before.queue.map((q) => q.customerName)).toEqual([
      "Andre",
      "Betty",
      "Chipo",
      "Dora",
      "Enock",
    ]);

    // Work through three of them.
    for (const row of before.queue.slice(0, 3)) {
      await asOwner(t).mutation(api.messages.markOpened, { ...SLUG, outboxId: row.id });
      await asOwner(t).mutation(api.messages.markSent, { ...SLUG, outboxId: row.id });
    }

    // THE RELOAD: nothing is carried over from the client — the query is
    // asked again from scratch, which is what a refresh actually does.
    const after = await readOutbox(t);
    expect(after.queue).toHaveLength(2);
    expect(after.queue.map((q) => q.customerName)).toEqual(["Dora", "Enock"]);
    expect(after.doneToday).toBe(3);
    // Nothing lost: five rows still exist, three of them sent.
    const all = await t.run(async (ctx) => ctx.db.query("outbox").collect());
    expect(all).toHaveLength(5);
    expect(all.filter((r) => r.status === "sent")).toHaveLength(3);
  });

  test("a row she opened and walked away from comes back as opened", async () => {
    // `approved` with an openedAt and no sentAt — the state a reload has to
    // resume, not silently reset.
    const t = await kitchen();
    await five(t);
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "whatsapp",
    });
    const first = (await readOutbox(t)).queue[0];
    await asOwner(t).mutation(api.messages.markOpened, { ...SLUG, outboxId: first.id });

    const after = await readOutbox(t);
    const same = after.queue.find((q) => q.id === first.id)!;
    expect(same.opened).toBe(true);
    expect(same.openedAt).toBeTypeOf("number");
    // Still in the queue — opening is not sending.
    expect(after.queue).toHaveLength(5);
    expect(after.doneToday).toBe(0);
  });

  test("ACCEPTANCE: opening then skipping leaves it dismissed, never sent", async () => {
    const t = await kitchen();
    await five(t);
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "whatsapp",
    });
    const first = (await readOutbox(t)).queue[0];
    await asOwner(t).mutation(api.messages.markOpened, { ...SLUG, outboxId: first.id });
    await asOwner(t).mutation(api.messages.markSkipped, { ...SLUG, outboxId: first.id });

    const row = await t.run(async (ctx) => ctx.db.get(first.id));
    expect(row!.status).toBe("dismissed");
    expect(row!.sentAt).toBeUndefined();
    expect((await readOutbox(t)).doneToday).toBe(0);
  });

  test("marking sent twice writes once", async () => {
    const t = await kitchen();
    await five(t);
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "whatsapp",
    });
    const first = (await readOutbox(t)).queue[0];
    await asOwner(t).mutation(api.messages.markSent, { ...SLUG, outboxId: first.id });
    const stamp = (await t.run(async (ctx) => ctx.db.get(first.id)))!.sentAt;

    vi.setSystemTime(new Date(`${TODAY}T11:00:00Z`));
    await asOwner(t).mutation(api.messages.markSent, { ...SLUG, outboxId: first.id });
    // The stamp does not move — the first send is when it happened.
    expect((await t.run(async (ctx) => ctx.db.get(first.id)))!.sentAt).toBe(stamp);
  });

  test("ACCEPTANCE: an opted-out contact never becomes a queue row", async () => {
    const t = await kitchen();
    await five(t);
    const contacts = await asOwner(t).query(api.customers.list, { ...SLUG, today: TODAY });
    const chipo = contacts.rows.find((r) => r.name === "Chipo")!;
    await asOwner(t).mutation(api.customers.optOut, { ...SLUG, customerId: chipo.id });

    const started = await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "whatsapp",
    });
    expect(started.created).toBe(4);
    expect(started.excluded).toBe(1);

    const { queue } = await readOutbox(t);
    expect(queue.map((q) => q.customerName)).not.toContain("Chipo");
    // Not merely absent from the view — no row exists at all.
    const rows = await t.run(async (ctx) => ctx.db.query("outbox").collect());
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows)).not.toContain(chipo.id);
  });

  test("narrowing the list cannot add somebody back in", async () => {
    const t = await kitchen();
    await five(t);
    const contacts = await asOwner(t).query(api.customers.list, { ...SLUG, today: TODAY });
    const chipo = contacts.rows.find((r) => r.name === "Chipo")!;
    await asOwner(t).mutation(api.customers.optOut, { ...SLUG, customerId: chipo.id });

    const andre = contacts.rows.find((r) => r.name === "Andre")!;

    // She explicitly picks BOTH. Consent still wins for Chipo, and only
    // Andre gets a row — narrowing can subtract from the list, never add.
    const started = await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "whatsapp",
      onlyCustomerIds: [chipo.id as Id<"customers">, andre.id as Id<"customers">],
    });
    expect(started.created).toBe(1);
    expect(started.excluded).toBe(1);
    const rows = await t.run(async (ctx) => ctx.db.query("outbox").collect());
    expect(JSON.stringify(rows)).not.toContain(chipo.id);

    // And picking ONLY her is refused outright rather than starting an empty
    // batch she would sit and wait on.
    await expect(
      asOwner(t).mutation(api.messages.startBatch, {
        ...SLUG,
        body: "Hi {name}.",
        channel: "whatsapp",
        onlyCustomerIds: [chipo.id as Id<"customers">],
      }),
    ).rejects.toThrow(/Nobody on that list/);
  });

  test("a batch nobody can receive is refused rather than started empty", async () => {
    const t = await kitchen();
    await customer(t, "Rudo", "+263771234567", { withOrder: false });
    await expect(
      asOwner(t).mutation(api.messages.startBatch, {
        ...SLUG,
        body: "Hi {name}, your {item} is ready.",
        channel: "whatsapp",
      }),
    ).rejects.toThrow(/Nobody on that list/);
  });

  test("the body is filled per recipient and never re-rendered downstream", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}, your {item} is ready.",
      channel: "whatsapp",
    });
    const { queue } = await readOutbox(t);
    expect(queue[0].body).toBe("Hi Andre, your Chocolate cake is ready.");
    expect(queue[0].body).not.toContain("{");
  });
});

describe("recurring schedules", () => {
  async function weekly(t: ReturnType<typeof convexTest>, weekday = 0) {
    const templateId = await asOwner(t).mutation(api.messages.saveTemplate, {
      ...SLUG,
      name: "Taking orders",
      channel: "whatsapp",
      body: "Hi {name}, taking orders this week.",
    });
    await asOwner(t).mutation(api.messages.saveSchedule, { ...SLUG, templateId, weekday });
    return templateId;
  }

  test("a draft is due on the day, and not the day after", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await weekly(t, 0); // Sunday

    expect((await readOutbox(t)).dueDrafts).toHaveLength(1);
    expect((await readOutbox(t, "2026-08-10")).dueDrafts).toHaveLength(0);
  });

  test("nothing is generated in advance — no rows until she acts", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await weekly(t);
    await readOutbox(t);
    // The draft is derived. Reading it wrote nothing.
    expect(await t.run(async (ctx) => ctx.db.query("outbox").collect())).toHaveLength(0);
  });

  test("dismissing it keeps it gone for that week, and it returns the next", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await weekly(t);
    const due = (await readOutbox(t)).dueDrafts[0];
    expect(due.key).toBe(`${due.scheduleId}:${TODAY}`);

    await asOwner(t).mutation(api.messages.dismissDue, {
      ...SLUG,
      scheduleKey: due.key,
      body: due.body,
    });
    expect((await readOutbox(t)).dueDrafts).toHaveLength(0);
    // The following Sunday is a different key.
    expect((await readOutbox(t, "2026-08-16")).dueDrafts).toHaveLength(1);
  });

  test("starting the batch from a due draft answers it", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await weekly(t);
    const due = (await readOutbox(t)).dueDrafts[0];

    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: due.body,
      channel: "whatsapp",
      scheduleKey: due.key,
    });
    const after = await readOutbox(t);
    expect(after.dueDrafts).toHaveLength(0);
    expect(after.queue).toHaveLength(1);
  });

  test("a paused schedule is never due", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    const templateId = await weekly(t);
    const [schedule] = await asOwner(t).query(api.messages.schedules, {
      ...SLUG,
      today: TODAY,
    });
    await asOwner(t).mutation(api.messages.saveSchedule, {
      ...SLUG,
      scheduleId: schedule.id,
      templateId,
      weekday: 0,
      active: false,
    });
    expect((await readOutbox(t)).dueDrafts).toHaveLength(0);
  });

  test("a weekday outside 0–6 is refused", async () => {
    const t = await kitchen();
    const templateId = await asOwner(t).mutation(api.messages.saveTemplate, {
      ...SLUG,
      name: "X",
      channel: "whatsapp",
      body: "Hi.",
    });
    await expect(
      asOwner(t).mutation(api.messages.saveSchedule, { ...SLUG, templateId, weekday: 7 }),
    ).rejects.toThrow(/0 to 6/);
  });
});

describe("reorder reminders land here", () => {
  test("the outbox reads the SAME list the customers screen does", async () => {
    // Not a second derivation — convex/customers.ts exported loadReminders
    // for exactly this, and two screens disagreeing about who to contact is
    // worse than either being wrong alone.
    const t = await kitchen();
    const andre = await customer(t, "Andre", "+263715550184");
    await t.run(async (ctx) => {
      const orderId = await ctx.db.insert("orders", {
        orgId: "org_kitchen_a",
        customerId: andre,
        orderDate: "2025-08-12",
        deliveryDate: "2025-08-12",
        status: "delivered" as const,
        occasion: "birthday" as const,
        deliveryFeeCents: 0,
        deliveryCostCents: 0,
        discountCents: 0,
        taxRateBpAtCreation: 0,
        taxInclusiveAtCreation: false,
        revision: 0,
        source: "app" as const,
        feedbackToken: "f_b",
        invoiceToken: "i_b",
      });
      await ctx.db.insert("orderLines", {
        orgId: "org_kitchen_a",
        orderId,
        description: "Birthday cake",
        qtyMilli: 1_000,
        unitPriceCents: 4_000,
        uncosted: true,
      });
    });

    const fromMessages = await readOutbox(t);
    const fromCustomers = await asOwner(t).query(api.customers.list, {
      ...SLUG,
      today: TODAY,
    });
    expect(fromMessages.reminders).toHaveLength(1);
    expect(JSON.stringify(fromMessages.reminders)).toBe(
      JSON.stringify(fromCustomers.reminders),
    );
  });
});

describe("campaigns", () => {
  test("creating one queues a row per recipient and mints a token", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await customer(t, "Betty", "+263715550185");

    const { campaignId, recipients } = await asOwner(t).mutation(
      api.messages.createCampaign,
      {
        ...SLUG,
        name: "August specials",
        channel: "whatsapp",
        body: "Hi {name}, new menu this month.",
      },
    );
    expect(recipients).toBe(2);

    const history = await asOwner(t).query(api.messages.campaignHistory, SLUG);
    expect(history).toHaveLength(1);
    expect(history[0].recipients).toBe(2);
    expect(history[0].sent).toBe(0);
    expect(history[0].token).toMatch(/^c_/);
    expect(history[0].id).toBe(campaignId);

    expect((await readOutbox(t)).queue).toHaveLength(2);
  });

  test("the public page resolves by token and shows no recipients", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await asOwner(t).mutation(api.messages.createCampaign, {
      ...SLUG,
      name: "August specials",
      channel: "whatsapp",
      body: "Hi {name}, new menu.",
    });
    const [campaign] = await asOwner(t).query(api.messages.campaignHistory, SLUG);

    const page = await t.query(api.messages.campaignByToken, { token: campaign.token });
    expect(page).not.toBeNull();
    expect(page!.kitchenName).toBe("Kitchen A");
    expect(page!.name).toBe("August specials");
    // A stranger must never see who it went to.
    expect(JSON.stringify(page)).not.toContain("Andre");
    expect(JSON.stringify(page)).not.toContain("recipient");
  });

  test("a wrong-shaped or unknown token is null, never an error", async () => {
    const t = await kitchen();
    expect(await t.query(api.messages.campaignByToken, { token: "i_abc" })).toBeNull();
    expect(await t.query(api.messages.campaignByToken, { token: "c_nope" })).toBeNull();
  });

  test("replacing the token burns the old link and keeps the campaign", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await asOwner(t).mutation(api.messages.createCampaign, {
      ...SLUG,
      name: "Specials",
      channel: "whatsapp",
      body: "Hi {name}.",
    });
    const [before] = await asOwner(t).query(api.messages.campaignHistory, SLUG);

    const next = await asOwner(t).mutation(api.messages.replaceCampaignToken, {
      ...SLUG,
      campaignId: before.id,
    });
    expect(next).not.toBe(before.token);
    expect(await t.query(api.messages.campaignByToken, { token: before.token })).toBeNull();
    expect(await t.query(api.messages.campaignByToken, { token: next })).not.toBeNull();
    // The history survives.
    expect(await asOwner(t).query(api.messages.campaignHistory, SLUG)).toHaveLength(1);
  });
});

describe("the email send payload", () => {
  test("carries the address from the customer row and never from the caller", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184", { email: "andre@example.com" });
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}, the August menu is out.",
      channel: "email",
    });
    const [row] = (await readOutbox(t)).queue;

    const payload = await asOwner(t).query(api.messages.sendPayload, {
      ...SLUG,
      outboxId: row.id,
    });
    expect(payload.to).toBe("andre@example.com");
    expect(payload.body).toContain("Andre");
    expect(payload.alreadySent).toBe(false);
    expect(payload.attachmentUrl).toBeNull();
  });

  test("a WhatsApp row is NOT_FOUND — that path has no server in it", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "whatsapp",
    });
    const [row] = (await readOutbox(t)).queue;

    await expect(
      asOwner(t).query(api.messages.sendPayload, { ...SLUG, outboxId: row.id }),
    ).rejects.toThrow();
  });

  test("another kitchen's row is NOT_FOUND", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184", { email: "andre@example.com" });
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "email",
    });
    const [row] = (await readOutbox(t)).queue;

    await expect(
      t
        .withIdentity(OTHER)
        .query(api.messages.sendPayload, {
          orgSlug: "kitchen-b",
          outboxId: row.id,
        }),
    ).rejects.toThrow();
  });

  test("an already-sent row says so, so a retry cannot send twice", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184", { email: "andre@example.com" });
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "email",
    });
    const [row] = (await readOutbox(t)).queue;
    await asOwner(t).mutation(api.messages.markSent, { ...SLUG, outboxId: row.id });

    const payload = await asOwner(t).query(api.messages.sendPayload, {
      ...SLUG,
      outboxId: row.id,
    });
    expect(payload.alreadySent).toBe(true);
  });
});

describe("access", () => {
  test("staff reach none of it", async () => {
    const t = await kitchen();
    const asStaff = t.withIdentity(STAFF);
    await expect(
      asStaff.query(api.messages.outbox, { ...SLUG, today: TODAY }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      asStaff.query(api.messages.templates, SLUG),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      asStaff.mutation(api.messages.saveTemplate, {
        ...SLUG,
        name: "X",
        channel: "whatsapp",
        body: "Hi.",
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("another kitchen sees none of this one's outbox", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "whatsapp",
    });
    const theirs = await t
      .withIdentity(OTHER)
      .query(api.messages.outbox, { orgSlug: "kitchen-b", today: TODAY });
    expect(theirs.queue).toHaveLength(0);
  });

  test("another kitchen cannot mark this one's row sent", async () => {
    const t = await kitchen();
    await customer(t, "Andre", "+263715550184");
    await asOwner(t).mutation(api.messages.startBatch, {
      ...SLUG,
      body: "Hi {name}.",
      channel: "whatsapp",
    });
    const [row] = (await readOutbox(t)).queue;
    await expect(
      t
        .withIdentity(OTHER)
        .mutation(api.messages.markSent, { orgSlug: "kitchen-b", outboxId: row.id }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});
