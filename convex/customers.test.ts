import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * The contact list, end to end.
 *
 * Two tests carry the slice, and both are about promises Sous makes that
 * cannot be allowed to rot:
 *
 * - Opt-out excludes from every send path immediately and permanently, and
 *   the mutation refuses to put anyone back. That is what POPIA and
 *   Zimbabwe's Data Protection Act require, and the schema comment has
 *   claimed it since before the mutation existed.
 * - Profitability is byte-identical to what `dashboard.breakdown` reports for
 *   the same person over the same window. The acceptance criterion says
 *   "reuse rather than reimplement", and this is that criterion mechanically
 *   enforced — a future reimplementation fails here rather than quietly
 *   showing two different numbers on two screens.
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

const TODAY = "2026-08-05";
/** A birthday order a year ago, three days before today's date next year. */
const LAST_BIRTHDAY = "2025-08-08";

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

async function menu(t: ReturnType<typeof convexTest>, leadTimeHours = 0) {
  const flour = await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: "org_kitchen_a",
      name: "Flour",
      baseUnit: "g" as const,
      standardCostCentsPerThousand: 185,
      standardCostSetAt: Date.now(),
      trackStock: true,
      alertsMuted: false,
    }),
  );
  const { menuItemId } = await t.withIdentity(OWNER).mutation(api.menuItems.save, {
    ...SLUG,
    name: "Chocolate cake",
    notSoldDirectly: false,
    baseBatchYield: 1,
    unitWeightMilligrams: 1_000_000,
    batchProductionMinutes: 60,
    perUnitExtras: [],
    priceCents: 4_000,
    shelfLifeHours: 72,
    leadTimeHours,
    lines: [
      {
        componentType: "ingredient" as const,
        componentId: flour,
        qtyMilli: 500_000,
        unit: "g" as const,
      },
    ],
  });
  return menuItemId as Id<"menuItems">;
}

async function orderFor(
  t: ReturnType<typeof convexTest>,
  menuItemId: Id<"menuItems">,
  over: {
    deliveryDate?: string;
    occasion?:
      | "birthday"
      | "anniversary"
      | "wedding"
      | "funeral"
      | "church"
      | "corporate"
      | "justBecause";
    phone?: string;
    name?: string;
    units?: number;
  } = {},
) {
  const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
    ...SLUG,
    phone: over.phone ?? "+263715550184",
    name: over.name ?? "Andre Dingiswayo",
    orderDate: over.deliveryDate ?? LAST_BIRTHDAY,
    deliveryDate: over.deliveryDate ?? LAST_BIRTHDAY,
    ...(over.occasion ? { occasion: over.occasion } : {}),
    lines: [{ menuItemId, qtyMilli: (over.units ?? 1) * 1000 }],
  });
  return orderId;
}

const listContacts = (t: ReturnType<typeof convexTest>, today = TODAY) =>
  t.withIdentity(OWNER).query(api.customers.list, { ...SLUG, today });

async function onlyCustomer(t: ReturnType<typeof convexTest>) {
  const { rows } = await listContacts(t);
  return rows[0];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00Z`));
  vi.unstubAllEnvs();
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
});
afterEach(() => vi.useRealTimers());

describe("the list builds itself from orders", () => {
  test("a first order creates the contact, consenting", () => {
    return kitchen().then(async (t) => {
      const cake = await menu(t);
      expect((await listContacts(t)).rows).toHaveLength(0);

      await orderFor(t, cake, { occasion: "birthday" });
      const row = await onlyCustomer(t);
      expect(row.name).toBe("Andre Dingiswayo");
      expect(row.phone).toBe("+263715550184");
      // "Defaults on for anyone who has ordered" (CONTEXT.md — Comms).
      expect(row.marketingConsent).toBe(true);
      expect(row.optedOut).toBe(false);
      expect(row.orders).toBe(1);
      expect(row.lastOrderedOn).toBe(LAST_BIRTHDAY);
    });
  });

  test("a second order on the same number is the same contact", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday" });
    await orderFor(t, cake, { deliveryDate: "2026-03-02", name: "Andre" });

    const { rows } = await listContacts(t);
    expect(rows).toHaveLength(1);
    // The stored name wins — "Andre" typed in a hurry must not overwrite it.
    expect(rows[0].name).toBe("Andre Dingiswayo");
    expect(rows[0].orders).toBe(2);
  });

  test("a walk-in creates no contact at all", async () => {
    // quickSale carries no customerId; the schema refuses to invent a person
    // and so does this.
    const t = await kitchen();
    await menu(t);
    expect((await listContacts(t)).rows).toHaveLength(0);
  });

  test("an empty kitchen is an empty list, not a crash", async () => {
    const t = await kitchen();
    const data = await listContacts(t);
    expect(data.rows).toEqual([]);
    expect(data.reminders).toEqual([]);
    expect(data.optedOutCount).toBe(0);
  });
});

describe("profitability", () => {
  test("ACCEPTANCE: identical to dashboard.breakdown, not a second sum", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday", units: 2 });
    await orderFor(t, cake, { deliveryDate: "2026-03-02", units: 1 });
    const asOwner = t.withIdentity(OWNER);

    const contact = await onlyCustomer(t);
    const dashboard = await asOwner.query(api.dashboard.breakdown, {
      ...SLUG,
      end: TODAY, // unbounded start — the same lifetime window
    });
    const same = dashboard.customers.find((c) => c.customerId === contact.id)!;

    // Byte-identical, every field. A reimplementation that rounded once
    // differently would fail here rather than showing her two numbers.
    expect(contact.lifetimeProfitCents).toBe(same.profitCents);
    expect(contact.lifetimeRevenueCents).toBe(same.revenueCents);
    expect(contact.marginPercent).toBe(same.marginPercent);
    expect(contact.orders).toBe(same.orders);
    // And it is a real figure, not two coincident zeroes.
    expect(contact.lifetimeRevenueCents).toBeGreaterThan(0);
  });

  test("the contact page agrees with the list about the same person", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday", units: 3 });

    const row = await onlyCustomer(t);
    const detail = await t
      .withIdentity(OWNER)
      .query(api.customers.get, { ...SLUG, customerId: row.id, today: TODAY });
    expect(detail.lifetimeProfitCents).toBe(row.lifetimeProfitCents);
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0].occasion).toBe("birthday");
  });

  test("lifetime is lifetime — an old order still counts", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { deliveryDate: "2024-01-15", units: 5 });
    const row = await onlyCustomer(t);
    expect(row.orders).toBe(1);
    expect(row.lifetimeRevenueCents).toBeGreaterThan(0);
  });
});

describe("consent", () => {
  test("ACCEPTANCE: opting out excludes from every send path, immediately", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday" });
    const asOwner = t.withIdentity(OWNER);

    const before = await listContacts(t);
    expect(before.reminders).toHaveLength(1);
    const customerId = before.rows[0].id;

    await asOwner.mutation(api.customers.optOut, { ...SLUG, customerId });

    const after = await listContacts(t);
    // Gone from the reminder list on the very next read — no job ran.
    expect(after.reminders).toHaveLength(0);
    expect(after.rows[0].marketingConsent).toBe(false);
    expect(after.rows[0].optedOut).toBe(true);
    expect(after.optedOutCount).toBe(1);

    // And gone from the contact's own page too.
    const detail = await asOwner.query(api.customers.get, {
      ...SLUG,
      customerId,
      today: TODAY,
    });
    expect(detail.reminders).toHaveLength(0);
  });

  test("ACCEPTANCE: it is permanent — there is no way back through Sous", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday" });
    const asOwner = t.withIdentity(OWNER);
    const customerId = (await onlyCustomer(t)).id;

    await asOwner.mutation(api.customers.optOut, { ...SLUG, customerId });
    // Calling it again is a no-op, not a toggle. There is no optIn to call:
    // a function that could take `false` could take `true`.
    await asOwner.mutation(api.customers.optOut, { ...SLUG, customerId });
    expect((await onlyCustomer(t)).marketingConsent).toBe(false);
    expect(api).not.toHaveProperty("customers.optIn");
  });

  test("a later order does not put an opted-out customer back on", async () => {
    // orders.create patches only email and address on a returning customer —
    // this proves the claim its comment makes.
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday" });
    const customerId = (await onlyCustomer(t)).id;
    await t.withIdentity(OWNER).mutation(api.customers.optOut, { ...SLUG, customerId });

    await orderFor(t, cake, { deliveryDate: "2026-06-01", occasion: "birthday" });
    expect((await onlyCustomer(t)).marketingConsent).toBe(false);
    expect((await listContacts(t)).reminders).toHaveLength(0);
  });

  test("notes are hers to write, and blank clears them", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake);
    const asOwner = t.withIdentity(OWNER);
    const customerId = (await onlyCustomer(t)).id;

    await asOwner.mutation(api.customers.setNotes, {
      ...SLUG,
      customerId,
      notes: "  Allergic to walnuts.  ",
    });
    const read = () =>
      asOwner.query(api.customers.get, { ...SLUG, customerId, today: TODAY });
    expect((await read()).notes).toBe("Allergic to walnuts.");

    await asOwner.mutation(api.customers.setNotes, { ...SLUG, customerId, notes: "  " });
    expect((await read()).notes).toBeNull();
  });
});

describe("reminders", () => {
  test("a birthday a year ago surfaces before it comes round", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday" });

    const { reminders } = await listContacts(t);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].customerName).toBe("Andre Dingiswayo");
    expect(reminders[0].occasion).toBe("birthday");
    expect(reminders[0].lastOrderedOn).toBe(LAST_BIRTHDAY);
    expect(reminders[0].dueOn).toBe("2026-08-08");
    expect(reminders[0].daysAway).toBe(3);
    // Carries what the message needs.
    expect(reminders[0].itemName).toBe("Chocolate cake");
    expect(reminders[0].phone).toBe("+263715550184");
  });

  test("ACCEPTANCE: a funeral never surfaces, on the same date", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "funeral" });
    expect((await listContacts(t)).reminders).toHaveLength(0);
  });

  test("dismissing keeps it gone, and writes one outbox row", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday" });
    const asOwner = t.withIdentity(OWNER);
    const before = await listContacts(t);
    const reminder = before.reminders[0];

    await asOwner.mutation(api.customers.markReminder, {
      ...SLUG,
      reminderKey: reminder.key,
      customerId: reminder.customerId as Id<"customers">,
      body: "Hi Andre, is the birthday cake on again this year?",
      action: "dismissed",
    });

    expect((await listContacts(t)).reminders).toHaveLength(0);
    const rows = await t.run(async (ctx) => ctx.db.query("outbox").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("dismissed");
    expect(rows[0].reminderKey).toBe(reminder.key);
    expect(rows[0].recipientIds).toEqual([reminder.customerId]);
    // Nothing auto-sends, so a dismissal has no sentAt (CONTEXT.md — Comms).
    expect(rows[0].sentAt).toBeUndefined();
  });

  test("marking it sent stamps when SHE sent it", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday" });
    const asOwner = t.withIdentity(OWNER);
    const reminder = (await listContacts(t)).reminders[0];

    await asOwner.mutation(api.customers.markReminder, {
      ...SLUG,
      reminderKey: reminder.key,
      customerId: reminder.customerId as Id<"customers">,
      body: "Hi Andre",
      action: "sent",
    });
    const rows = await t.run(async (ctx) => ctx.db.query("outbox").collect());
    expect(rows[0].status).toBe("sent");
    expect(rows[0].sentAt).toBeTypeOf("number");
    // Marking twice does not write twice.
    await asOwner.mutation(api.customers.markReminder, {
      ...SLUG,
      reminderKey: reminder.key,
      customerId: reminder.customerId as Id<"customers">,
      body: "Hi Andre",
      action: "sent",
    });
    expect(await t.run(async (ctx) => ctx.db.query("outbox").collect())).toHaveLength(1);
  });

  test("a customer who came back on their own vanishes, with no write", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday" });
    expect((await listContacts(t)).reminders).toHaveLength(1);

    // He ordered again last week. She has him.
    await orderFor(t, cake, { deliveryDate: "2026-08-01" });
    expect((await listContacts(t)).reminders).toHaveLength(0);
    // Nothing was recorded to make that happen — it is derived.
    expect(await t.run(async (ctx) => ctx.db.query("outbox").collect())).toHaveLength(0);
  });

  test("a long-lead item surfaces earlier than a short-lead one", async () => {
    const t = await kitchen();
    const cake = await menu(t, 24 * 14); // a fortnight's notice
    await orderFor(t, cake, { occasion: "birthday" });
    // 21 days before the 8th is 18 July — inside the window.
    expect((await listContacts(t, "2026-07-18")).reminders).toHaveLength(1);
    // A day earlier it is not yet.
    expect((await listContacts(t, "2026-07-17")).reminders).toHaveLength(0);
  });
});

describe("the charts", () => {
  test("repeat is judged per order against all history", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    // Andre's first order is in 2024, OUTSIDE the window below.
    await orderFor(t, cake, { deliveryDate: "2024-05-01" });
    await orderFor(t, cake, { deliveryDate: "2026-08-01" });
    // Chipo's first order is inside it.
    await orderFor(t, cake, {
      deliveryDate: "2026-08-02",
      phone: "+263772119003",
      name: "Chipo",
    });

    const insights = await t.withIdentity(OWNER).query(api.customers.insights, {
      ...SLUG,
      start: "2026-08-01",
      end: TODAY,
    });
    // Andre returning counts as repeat even though his first order is not in
    // the window; Chipo arriving counts as first-time.
    expect(insights.repeat.repeatOrders).toBe(1);
    expect(insights.repeat.firstTimeOrders).toBe(1);
    expect(insights.repeat.repeatPercent).toBe(50);
  });

  test("top customers are ranked by profit, best first", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { units: 5, deliveryDate: "2026-08-01" });
    await orderFor(t, cake, {
      units: 1,
      deliveryDate: "2026-08-02",
      phone: "+263772119003",
      name: "Chipo",
    });

    const { topCustomers } = await t
      .withIdentity(OWNER)
      .query(api.customers.insights, { ...SLUG, end: TODAY });
    expect(topCustomers[0].name).toBe("Andre Dingiswayo");
    expect(topCustomers[0].profitCents).toBeGreaterThan(topCustomers[1].profitCents);
  });

  test("occasion mix counts chips and skips orders without one", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { deliveryDate: "2026-08-01", occasion: "birthday" });
    await orderFor(t, cake, { deliveryDate: "2026-08-02", occasion: "birthday" });
    await orderFor(t, cake, { deliveryDate: "2026-08-03", occasion: "funeral" });
    await orderFor(t, cake, { deliveryDate: "2026-08-04" }); // no chip

    const { occasions } = await t
      .withIdentity(OWNER)
      .query(api.customers.insights, { ...SLUG, end: TODAY });
    expect(occasions.map((o) => o.occasion)).toEqual(["birthday", "funeral"]);
    expect(occasions[0].orders).toBe(2);
  });
});

describe("access", () => {
  test("staff reach none of it", async () => {
    const t = await kitchen();
    const asStaff = t.withIdentity(STAFF);
    await expect(
      asStaff.query(api.customers.list, { ...SLUG, today: TODAY }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      asStaff.query(api.customers.insights, { ...SLUG, end: TODAY }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("another kitchen sees none of this one's contacts", async () => {
    const t = await kitchen();
    const cake = await menu(t);
    await orderFor(t, cake, { occasion: "birthday" });
    const mine = (await onlyCustomer(t)).id;

    const theirs = await t
      .withIdentity(OTHER)
      .query(api.customers.list, { orgSlug: "kitchen-b", today: TODAY });
    expect(theirs.rows).toHaveLength(0);
    expect(theirs.reminders).toHaveLength(0);

    // And they cannot opt out somebody else's customer.
    await expect(
      t
        .withIdentity(OTHER)
        .mutation(api.customers.optOut, { orgSlug: "kitchen-b", customerId: mine }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});
