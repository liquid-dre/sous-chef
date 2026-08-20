import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Invoicing acceptance:
 * - a number is allocated on materialise, idempotently, and concurrent
 *   materialising never produces the same number twice;
 * - orders that never become documents consume no numbers;
 * - editing a sent order increments revision exactly once per edit;
 * - the document's identity — prefix, ZWG rate — freezes when it is issued;
 * - the public token read exposes no cost, ever.
 */

const OWNER = {
  subject: "user_owner",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:admin",
};
const STAFF = { ...OWNER, subject: "user_staff", org_role: "org:member" };
const SLUG = { orgSlug: "kitchen-a" };
const DAY = "2026-08-04";

async function kitchen() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  await t
    .withIdentity({ subject: "user_super" })
    .mutation(api.admin.provisionOrg, {
      orgId: "org_kitchen_a",
      slug: "kitchen-a",
      name: "Rutendo's Kitchen",
    });
  await t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
    ...SLUG,
    overheadRateCentsPerHour: 800,
    deliveryFeeModel: "flat",
    deliveryFeeConfig: { flatCents: 500 },
    address: "14 Samora Machel Ave, Harare",
    phone: "+263 71 555 0184",
    email: "rutendo@example.co.zw",
    paymentInstructions: "EcoCash 0715550184",
    terms: "Payment within 7 days.",
  });
  return t;
}

async function anOrder(
  t: ReturnType<typeof convexTest>,
  over: { phone?: string; name?: string; unitPriceCents?: number } = {},
) {
  const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
    ...SLUG,
    phone: over.phone ?? "+263715550184",
    name: over.name ?? "Tariro Moyo",
    orderDate: DAY,
    deliveryDate: DAY,
    lines: [
      {
        description: "Custom cake",
        qtyMilli: 1_000,
        unitPriceCents: over.unitPriceCents ?? 7_500,
      },
    ],
  });
  return orderId;
}

const tokenOf = async (t: ReturnType<typeof convexTest>, orderId: Id<"orders">) =>
  (await t.run(async (ctx) => ctx.db.get(orderId)))!.invoiceToken;

describe("issuing a number", () => {
  test("ACCEPTANCE: materialise is idempotent — tapping Invoice twice issues one", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);

    const first = await asOwner.mutation(api.invoices.materialise, {
      ...SLUG, orderId,
    });
    const second = await asOwner.mutation(api.invoices.materialise, {
      ...SLUG, orderId,
    });
    expect(first.number).toBe(1);
    expect(second.number).toBe(1);
    expect(first.label).toBe("INV-0001");

    const org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect())[0]);
    expect(org.invoiceSequence).toBe(1);
  });

  test("ACCEPTANCE: many invoices issued at once never share a number", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    // Honest about what this proves. convex-test SERIALISES transactions —
    // probed directly: five closures reading a counter with an await between
    // read and write observed 0,1,2,3,4, never a repeat. So this cannot
    // exercise a genuine interleave, and the real guarantee is Convex's OCC:
    // every materialise reads orgs.invoiceSequence and writes it back, so the
    // org document is in both the read and the write set and concurrent
    // callers conflict and retry. What this test DOES lock is the structural
    // precondition for that — one read-modify-write, inside one mutation,
    // against one document — plus the invariant that matters either way: no
    // two orders ever carry the same number. The guard below keeps the
    // allocation from sprouting a second site that could race differently.
    const orders = await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        anOrder(t, { phone: `+26377211900${i}`, name: `Customer ${i}` }),
      ),
    );
    const issued = await Promise.all(
      orders.map((orderId) =>
        asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId }),
      ),
    );

    const numbers = issued.map((r) => r.number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);

    // Asserted on the stored documents, not the return values: a mutation
    // could return the right number and persist the wrong one.
    const stored = await t.run(async (ctx) =>
      (await ctx.db.query("orders").collect()).map((o) => o.invoiceNumber),
    );
    expect(stored.filter((n) => n != null)).toHaveLength(5);
    expect(new Set(stored).size).toBe(5);

    const org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect())[0]);
    expect(org.invoiceSequence).toBe(5);
  });

  test("an order that never becomes a document takes no number", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    await anOrder(t);
    await anOrder(t, { phone: "+263772119003", name: "Rudo" });
    const third = await anOrder(t, { phone: "+263772119004", name: "Tanaka" });

    let org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect())[0]);
    expect(org.invoiceSequence).toBe(0);

    const issued = await asOwner.mutation(api.invoices.materialise, {
      ...SLUG, orderId: third,
    });
    // Not INV-0003. Every number has a document behind it, which is the
    // question an auditor actually asks.
    expect(issued.label).toBe("INV-0001");
    org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect())[0]);
    expect(org.invoiceSequence).toBe(1);
  });

  test("staff can issue an invoice — it carries no cost", async () => {
    const t = await kitchen();
    const orderId = await anOrder(t);
    const issued = await t
      .withIdentity(STAFF)
      .mutation(api.invoices.materialise, { ...SLUG, orderId });
    expect(issued.number).toBe(1);
  });

  test("another kitchen's order is not found", async () => {
    const t = await kitchen();
    const orderId = await anOrder(t);
    await expect(
      t
        .withIdentity({ ...OWNER, org_id: "org_b", org_slug: "kitchen-b" })
        .mutation(api.invoices.materialise, {
          orgSlug: "kitchen-b",
          orderId,
        }),
    ).rejects.toThrow();
  });
});

describe("what freezes when it is issued", () => {
  test("ACCEPTANCE: the prefix and ZWG rate survive a later settings change", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG,
      invoicePrefix: "RK",
      zwgDisplayEnabled: true,
      zwgRateMilli: 26_400,
    });
    const orderId = await anOrder(t);
    const issued = await asOwner.mutation(api.invoices.materialise, {
      ...SLUG, orderId,
    });
    expect(issued.label).toBe("RK-0001");

    // She rebrands and the rate moves, months later.
    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG,
      invoicePrefix: "SOUS",
      zwgRateMilli: 41_800,
    });

    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.order.invoiceLabel).toBe("RK-0001");
    expect(data.invoiceOrg.zwgRateMilli).toBe(26_400);

    // And so does the copy the customer holds.
    const pub = await t.query(api.invoices.byToken, {
      token: await tokenOf(t, orderId),
    });
    expect(pub!.invoice.prefix).toBe("RK");
    expect(pub!.zwgRateMilli).toBe(26_400);
  });

  test("a draft still quotes today's ZWG rate", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG, zwgDisplayEnabled: true, zwgRateMilli: 26_400,
    });
    const orderId = await anOrder(t);

    // Nothing issued yet, so the preview reads live — she is still quoting.
    let data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.order.invoiceNumber).toBeNull();
    expect(data.invoiceOrg.zwgRateMilli).toBe(26_400);

    await asOwner.mutation(api.orgs.updateProfile, { ...SLUG, zwgRateMilli: 41_800 });
    data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.invoiceOrg.zwgRateMilli).toBe(41_800);
  });

  test("ZWG switched off stamps nothing, so nothing prints", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);
    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });

    // Enabling it afterwards must not retro-print a line on an issued
    // document: the absence of a stamp IS the flag.
    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG, zwgDisplayEnabled: true, zwgRateMilli: 26_400,
    });
    const pub = await t.query(api.invoices.byToken, {
      token: await tokenOf(t, orderId),
    });
    expect(pub!.zwgRateMilli).toBeNull();
  });
});

describe("sending, and revisions", () => {
  test("markSent stamps once — re-sharing is not a second send", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);

    const first = await asOwner.mutation(api.invoices.markSent, { ...SLUG, orderId });
    // Issues in the same call, so sharing a never-invoiced order is one tap.
    expect(first.number).toBe(1);
    const second = await asOwner.mutation(api.invoices.markSent, { ...SLUG, orderId });
    expect(second.sentAt).toBe(first.sentAt);
  });

  test("ACCEPTANCE: an edit before the send raises no revision, after it raises exactly one", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);

    // Never sent: cancelling is an edit nobody outside the kitchen can see.
    const quiet = await anOrder(t);
    await asOwner.mutation(api.orders.cancel, {
      ...SLUG, orderId: quiet, reason: "She changed her mind.",
    });
    expect((await t.run(async (ctx) => ctx.db.get(quiet)))!.revision).toBe(0);

    // Sent: the same edit now contradicts a document someone is holding.
    const sent = await anOrder(t, { phone: "+263772119003", name: "Rudo" });
    await asOwner.mutation(api.invoices.markSent, { ...SLUG, orderId: sent });
    expect((await t.run(async (ctx) => ctx.db.get(sent)))!.revision).toBe(0);
    await asOwner.mutation(api.orders.cancel, {
      ...SLUG, orderId: sent, reason: "The wedding was called off.",
    });
    // Exactly one. The mutation IS the edit session, so there is no window to
    // debounce and no counter to double-fire.
    expect((await t.run(async (ctx) => ctx.db.get(sent)))!.revision).toBe(1);
  });

  test("the revision prints on the customer's copy", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);
    await asOwner.mutation(api.invoices.markSent, { ...SLUG, orderId });
    await asOwner.mutation(api.orders.cancel, {
      ...SLUG, orderId, reason: "Called off.",
    });
    const pub = await t.query(api.invoices.byToken, {
      token: await tokenOf(t, orderId),
    });
    expect(pub!.invoice.revision).toBe(1);
    expect(pub!.cancelled).toBe(true);
  });
});

describe("the customer's copy", () => {
  test("ACCEPTANCE: the public payload carries no cost, anywhere", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    // A costed menu line, so there IS a cogsSnapshot to leak.
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
    const { menuItemId } = await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      name: "Brownies",
      notSoldDirectly: false,
      baseBatchYield: 12,
      unitWeightMilligrams: 85_000,
      batchProductionMinutes: 60,
      perUnitExtras: [{ label: "Box", costCents: 20 }],
      priceCents: 300,
      shelfLifeHours: 72,
      lines: [
        {
          componentType: "ingredient" as const,
          componentId: flour,
          qtyMilli: 500_000,
          unit: "g" as const,
        },
      ],
    });
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...SLUG,
      phone: "+263715550184",
      name: "Tariro Moyo",
      orderDate: DAY,
      deliveryDate: DAY,
      lines: [{ menuItemId: menuItemId as Id<"menuItems">, qtyMilli: 12_000 }],
    });
    // It really is costed on the inside.
    const rows = await t.run(async (ctx) => ctx.db.query("orderLines").collect());
    expect(rows[0].cogsSnapshot!.ingredientsCents).toBeGreaterThan(0);

    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });
    const pub = await t.query(api.invoices.byToken, {
      token: await tokenOf(t, orderId),
    });

    // Asserted on the serialised bytes, which survives a refactor that a
    // type check would wave through. This is the only unauthenticated read
    // in Sous; a leak here reaches the open internet.
    const serialised = JSON.stringify(pub);
    for (const leak of [
      "cogsSnapshot",
      "ingredientsCents",
      "perUnitExtras",
      "overheadCents",
      "roughCost",
      "margin",
      "costing",
      "uncosted",
      "deliveryCost",
    ]) {
      expect(serialised, `public invoice leaks ${leak}`).not.toContain(leak);
    }
    // …while still being a usable document.
    expect(pub!.lines[0].description).toBe("Brownies");
    expect(pub!.org.name).toBe("Rutendo's Kitchen");
    expect(pub!.paymentInstructions).toBe("EcoCash 0715550184");
  });

  test("a token that cannot be honoured reads as no invoice, never as an error", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);

    // Never issued: this link cannot legitimately be in anyone's hands.
    expect(
      await t.query(api.invoices.byToken, { token: await tokenOf(t, orderId) }),
    ).toBeNull();

    // A feedback token pasted into the invoice route.
    const feedback = (await t.run(async (ctx) => ctx.db.get(orderId)))!.feedbackToken;
    expect(await t.query(api.invoices.byToken, { token: feedback })).toBeNull();

    // Garbage, and a well-shaped guess.
    expect(await t.query(api.invoices.byToken, { token: "" })).toBeNull();
    expect(
      await t.query(api.invoices.byToken, { token: "i_00000000-0000-0000-0000-000000000000" }),
    ).toBeNull();

    // Issued: now it resolves.
    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });
    expect(
      await t.query(api.invoices.byToken, { token: await tokenOf(t, orderId) }),
    ).not.toBeNull();
  });

  test("a walk-in has no customer block, and no invented one", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const flour = await t.run(async (ctx) =>
      ctx.db.insert("ingredients", {
        orgId: "org_kitchen_a", name: "Flour", baseUnit: "g" as const,
        standardCostCentsPerThousand: 185, standardCostSetAt: Date.now(),
        trackStock: true, alertsMuted: false,
      }),
    );
    const { menuItemId } = await asOwner.mutation(api.menuItems.save, {
      ...SLUG, name: "Scones", notSoldDirectly: false, baseBatchYield: 20,
      unitWeightMilligrams: 60_000, batchProductionMinutes: 30,
      perUnitExtras: [], priceCents: 150, shelfLifeHours: 24,
      lines: [{ componentType: "ingredient" as const, componentId: flour, qtyMilli: 400_000, unit: "g" as const }],
    });
    const { orderId } = await asOwner.mutation(api.orders.quickSale, {
      ...SLUG, menuItemId: menuItemId as Id<"menuItems">, day: DAY,
    });
    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });

    const pub = await t.query(api.invoices.byToken, {
      token: await tokenOf(t, orderId),
    });
    expect(pub!.customer).toBeNull();
    // Not a sentinel person. The schema refuses to store one; the document
    // must not print one either.
    expect(JSON.stringify(pub)).not.toContain("Walk-in");
    // A counter sale is paid in full by the same tap that made it.
    expect(pub!.payments.balanceCents).toBe(0);
    expect(pub!.payments.paidCents).toBe(150);
  });

  test("payments received and balance due reach the document", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);
    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });
    await asOwner.mutation(api.payments.record, {
      ...SLUG, orderId, amountCents: 4_000, paidAt: Date.now(),
    });

    const pub = await t.query(api.invoices.byToken, {
      token: await tokenOf(t, orderId),
    });
    // $75 goods + $5 delivery.
    expect(pub!.deliveryFeeCents).toBe(500);
    expect(pub!.payments.paidCents).toBe(4_000);
    expect(pub!.payments.balanceCents).toBe(4_000);
  });
});

describe("getting it to the customer", () => {
  test("ACCEPTANCE: a view is recorded once, and never moves again", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);
    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });
    const token = await tokenOf(t, orderId);

    let data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.order.deliveryStatus).toBe("notSent");

    await asOwner.mutation(api.invoices.markSent, { ...SLUG, orderId });
    data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.order.deliveryStatus).toBe("sent");
    expect(data.order.viewedAt).toBeNull();

    await t.mutation(api.invoices.recordView, { token });
    data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.order.deliveryStatus).toBe("viewed");
    const firstView = data.order.viewedAt!;
    expect(firstView).toBeGreaterThan(0);

    // Hammering it cannot walk the timestamp forward or grow the row.
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.invoices.recordView, { token });
    }
    data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(data.order.viewedAt).toBe(firstView);
  });

  test("ACCEPTANCE: recordView is not an existence oracle", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);
    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });
    const real = await tokenOf(t, orderId);
    const feedback = (await t.run(async (ctx) => ctx.db.get(orderId)))!.feedbackToken;

    // A real token, a wrong one, a feedback one and rubbish are
    // indistinguishable to the caller. The token IS the authorisation, so an
    // endpoint that answered differently would let anyone hunt for live ones.
    for (const token of [real, feedback, "", "i_00000000-0000-0000-0000-000000000000", "nonsense"]) {
      expect(await t.mutation(api.invoices.recordView, { token })).toBeNull();
    }
  });

  test("an unissued invoice cannot be viewed", async () => {
    const t = await kitchen();
    const orderId = await anOrder(t);
    // Never materialised, so the link was never shareable and a "view" of it
    // is not a thing that can have happened.
    await t.mutation(api.invoices.recordView, { token: await tokenOf(t, orderId) });
    expect(
      (await t.run(async (ctx) => ctx.db.get(orderId)))!.invoiceViewedAt,
    ).toBeUndefined();
  });

  test("ACCEPTANCE: replacing the link 404s the old one and keeps the new one working", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);
    await asOwner.mutation(api.invoices.markSent, { ...SLUG, orderId });
    const oldToken = await tokenOf(t, orderId);
    await t.mutation(api.invoices.recordView, { token: oldToken });
    expect(await t.query(api.invoices.byToken, { token: oldToken })).not.toBeNull();

    const { token: newToken } = await asOwner.mutation(api.invoices.replaceToken, {
      ...SLUG, orderId,
    });
    expect(newToken).not.toBe(oldToken);
    // The whole point: the link that went to the wrong number is dead.
    expect(await t.query(api.invoices.byToken, { token: oldToken })).toBeNull();
    expect(await t.query(api.invoices.byToken, { token: newToken })).not.toBeNull();

    const data = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    // sentAt SURVIVES — a PDF is out there and someone may be holding it.
    expect(data.order.sentAt).not.toBeNull();
    // viewedAt is cleared — nobody has opened the NEW link.
    expect(data.order.viewedAt).toBeNull();
    expect(data.order.deliveryStatus).toBe("sent");
  });

  test("ACCEPTANCE: a replaced-then-edited order still bumps the revision", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);
    await asOwner.mutation(api.invoices.markSent, { ...SLUG, orderId });
    await asOwner.mutation(api.invoices.replaceToken, { ...SLUG, orderId });
    // Replacing the link is not un-sending. Clearing sentAt here would have
    // silently switched off revision tracking for a document someone holds.
    await asOwner.mutation(api.orders.cancel, {
      ...SLUG, orderId, reason: "Called off.",
    });
    expect((await t.run(async (ctx) => ctx.db.get(orderId)))!.revision).toBe(1);
  });

  test("the delivery payload is tenanted, addressed, and carries no cost", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...SLUG,
      phone: "+263715550184",
      name: "Tariro Moyo",
      email: "tariro@example.co.zw",
      orderDate: DAY,
      deliveryDate: DAY,
      lines: [{ description: "Custom cake", qtyMilli: 1_000, unitPriceCents: 7_500 }],
    });
    // Refuses before there is a document to send.
    await expect(
      asOwner.query(api.invoices.deliveryPayload, { ...SLUG, orderId }),
    ).rejects.toMatchObject({ data: { code: "NOT_ISSUED" } });

    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });
    const payload = await asOwner.query(api.invoices.deliveryPayload, {
      ...SLUG, orderId,
    });
    // The recipient comes from the SERVER. A route that took `to:` from the
    // browser would be a spam relay wearing her domain's reputation.
    expect(payload.to).toBe("tariro@example.co.zw");
    expect(payload.label).toBe("INV-0001");
    expect(payload.balanceCents).toBe(8_000);
    expect(JSON.stringify(payload)).not.toMatch(/cogsSnapshot|margin|costing/);

    // Another kitchen cannot reach it.
    await expect(
      t
        .withIdentity({ ...OWNER, org_id: "org_b", org_slug: "kitchen-b" })
        .query(api.invoices.deliveryPayload, { orgSlug: "kitchen-b", orderId }),
    ).rejects.toThrow();
  });

  test("a customer with no email is reported as unreachable, not as an error", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const orderId = await anOrder(t);
    await asOwner.mutation(api.invoices.materialise, { ...SLUG, orderId });
    const payload = await asOwner.query(api.invoices.deliveryPayload, {
      ...SLUG, orderId,
    });
    // Phone is the identity key and email is optional, so this is the common
    // case, not an edge one — the card omits the action rather than failing.
    expect(payload.to).toBeNull();
  });
});

describe("the invoice and the ledger agree", () => {
  test("ACCEPTANCE: a split line totals the same on the document and in the ledger", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    // Half a cake at $3.33 twice. Merged: round(1000 × 333 / 1000) = 333.
    // Totalled apart: round(166.5) + round(166.5) = 334. One cent, forever.
    const { orderId } = await asOwner.mutation(api.orders.create, {
      ...SLUG,
      phone: "+263715550184",
      name: "Tariro Moyo",
      orderDate: DAY,
      deliveryDate: DAY,
      deliveryFeeCentsOverride: 0,
      lines: [{ description: "Half tray", qtyMilli: 1_000, unitPriceCents: 333 }],
    });
    // Split it the way a part-from-stock fulfilment stores it: two rows, same
    // product, same price, each carrying its own snapshot.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("orderLines").collect();
      const original = rows[0];
      await ctx.db.patch(original._id, { qtyMilli: 500 });
      await ctx.db.insert("orderLines", {
        orgId: original.orgId,
        orderId: original.orderId,
        menuItemId: original.menuItemId,
        description: original.description,
        qtyMilli: 500,
        unitPriceCents: original.unitPriceCents,
        cogsSnapshot: original.cogsSnapshot,
        roughCostCents: original.roughCostCents,
        uncosted: original.uncosted,
      });
    });

    const detail = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    const list = await asOwner.query(api.orders.list, {
      ...SLUG, filter: "all", today: DAY,
    });
    const row = list.rows.find((r) => r.id === orderId)!;

    // One line on the customer's page, not two.
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0].qtyMilli).toBe(1_000);
    expect(detail.totals.totalCents).toBe(333);
    // And the ledger asks for exactly what the document prints.
    expect(row.totalCents).toBe(detail.totals.totalCents);

    // So paying the printed figure settles it, rather than leaving a cent.
    await asOwner.mutation(api.payments.record, {
      ...SLUG, orderId, amountCents: 333, paidAt: Date.now(),
    });
    const after = await asOwner.query(api.orders.get, { ...SLUG, orderId });
    expect(after.payments.status).toBe("paid");
    expect(after.payments.balanceCents).toBe(0);
  });
});
