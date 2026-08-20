import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Feedback, end to end.
 *
 * The aggregation is proved in convex/lib/feedback.test.ts. What is proved
 * here is who may write, who may read, and — the reason this file is long —
 * exactly what the second unauthenticated write in Sous refuses.
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
  vi.unstubAllEnvs();
});
afterEach(() => vi.useRealTimers());

async function kitchen() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  await t.withIdentity({ subject: "user_super" }).mutation(api.admin.provisionOrg, {
    orgId: "org_kitchen_a",
    slug: "kitchen-a",
    name: "Rutendo's Kitchen",
  });
  await t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
    ...SLUG,
    overheadRateCentsPerHour: 800,
    deliveryFeeModel: "flat",
    deliveryFeeConfig: { flatCents: 500 },
  });
  return t;
}

async function menu(
  t: ReturnType<typeof convexTest>,
  over: { name?: string; axes?: ("sweetness" | "moisture" | "portionSize")[] } = {},
) {
  const flour = await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: "org_kitchen_a",
      name: `Flour ${over.name ?? ""}`,
      baseUnit: "g" as const,
      standardCostCentsPerThousand: 185,
      standardCostSetAt: Date.now(),
      trackStock: true,
      alertsMuted: false,
    }),
  );
  const { menuItemId } = await t.withIdentity(OWNER).mutation(api.menuItems.save, {
    ...SLUG,
    name: over.name ?? "Brownies",
    notSoldDirectly: false,
    baseBatchYield: 12,
    unitWeightMilligrams: 85_000,
    batchProductionMinutes: 60,
    perUnitExtras: [{ label: "Box", costCents: 20 }],
    priceCents: 300,
    shelfLifeHours: 72,
    sensoryAxes: over.axes ?? ["sweetness", "moisture"],
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

async function anOrder(
  t: ReturnType<typeof convexTest>,
  items: Id<"menuItems">[],
  phone = "+263715550184",
) {
  const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
    ...SLUG,
    phone,
    name: "Tariro Moyo",
    orderDate: DAY,
    deliveryDate: DAY,
    lines: items.map((menuItemId) => ({ menuItemId, qtyMilli: 2_000 })),
  });
  return orderId as Id<"orders">;
}

const tokenFor = (t: ReturnType<typeof convexTest>, orderId: Id<"orders">) =>
  t.run(async (ctx) => (await ctx.db.get(orderId))!.feedbackToken);

describe("who may write and who may read", () => {
  test("staff log feedback but never see the analysis of it", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);

    // CONTEXT.md — Access: staff do "orders, production, feedback".
    await t.withIdentity(STAFF).mutation(api.feedback.log, {
      ...SLUG,
      orderId,
      menuItemId: brownie,
      axisRatings: [{ axis: "sweetness", value: 1 }],
    });

    // …but the per-item profile lives on the owner-only menu page.
    await expect(
      t.withIdentity(STAFF).query(api.feedback.forMenuItem, {
        ...SLUG,
        menuItemId: brownie,
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

    // What they logged is still visible on the order they logged it against.
    const onOrder = await t
      .withIdentity(STAFF)
      .query(api.feedback.forOrder, { ...SLUG, orderId });
    expect(onOrder.entries).toHaveLength(1);
  });

  test("another kitchen sees none of it", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await anOrder(t, [brownie]);
    await expect(
      t
        .withIdentity({ ...OWNER, org_id: "org_b", org_slug: "kitchen-b" })
        .query(api.feedback.forMenuItem, { orgSlug: "kitchen-b", menuItemId: brownie }),
    ).rejects.toThrow();
  });

  test("she can take back her own note but not somebody else's", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);
    const { feedbackId } = await t.withIdentity(OWNER).mutation(api.feedback.log, {
      ...SLUG,
      orderId,
      freeText: "Said it was lovely.",
    });
    await t.withIdentity(OWNER).mutation(api.feedback.remove, { ...SLUG, feedbackId });
    expect(
      (await t.withIdentity(OWNER).query(api.feedback.forOrder, { ...SLUG, orderId }))
        .entries,
    ).toHaveLength(0);

    await t.mutation(api.feedback.submit, {
      token: await tokenFor(t, orderId),
      perItem: [],
      flags: ["lovedIt"],
    });
    const [customerRow] = (
      await t.withIdentity(OWNER).query(api.feedback.forOrder, { ...SLUG, orderId })
    ).entries;
    await expect(
      t
        .withIdentity(OWNER)
        .mutation(api.feedback.remove, { ...SLUG, feedbackId: customerRow.id }),
    ).rejects.toThrow(/stays as they left it/);
  });
});

describe("her path takes half an answer", () => {
  test("a note with no rating and no flag saves", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);
    await t.withIdentity(OWNER).mutation(api.feedback.log, {
      ...SLUG,
      orderId,
      freeText: "  She said the icing was lovely but it arrived warm.  ",
    });
    const { entries } = await t
      .withIdentity(OWNER)
      .query(api.feedback.forOrder, { ...SLUG, orderId });
    expect(entries[0].freeText).toBe(
      "She said the icing was lovely but it arrived warm.",
    );
    expect(entries[0].source).toBe("chef");
  });

  test("an entirely empty entry is refused rather than counted", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);
    await expect(
      t.withIdentity(OWNER).mutation(api.feedback.log, { ...SLUG, orderId, freeText: "  " }),
    ).rejects.toThrow(/Nothing to save yet/);
  });

  test("an axis the item does not carry is refused", async () => {
    const t = await kitchen();
    const brownie = await menu(t, { axes: ["sweetness", "moisture"] });
    const orderId = await anOrder(t, [brownie]);
    await expect(
      t.withIdentity(OWNER).mutation(api.feedback.log, {
        ...SLUG,
        orderId,
        menuItemId: brownie,
        axisRatings: [{ axis: "heat", value: 1 }],
      }),
    ).rejects.toThrow(/isn't one of this item's axes/);
  });
});

describe("the public form", () => {
  /** No identity: the whole point is that this reaches the database without
   * one. `_args` is the generated arg type, so a tampered payload in a test
   * still has to be a payload the validator would accept. */
  const submit = (
    t: ReturnType<typeof convexTest>,
    args: (typeof api.feedback.submit)["_args"],
  ) => t.mutation(api.feedback.submit, args);

  test("the payload carries her branding and no price, cost or phone number", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);
    const token = await tokenFor(t, orderId);

    const data = await t.query(api.feedback.byToken, { token });
    expect(data!.org.name).toBe("Rutendo's Kitchen");
    expect(data!.items.map((i) => i.name)).toEqual(["Brownies"]);
    expect(data!.customerFirstName).toBe("Tariro");
    // Assert on the bytes, not on the shape: a column added to orders or
    // menuItems later must not be able to arrive here by accident.
    const serialised = JSON.stringify(data);
    for (const forbidden of ["priceCents", "cogs", "Cents", "+2637", "Moyo"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  test("only items that have axes are asked about", async () => {
    const t = await kitchen();
    const withAxes = await menu(t, { name: "Brownies" });
    const without = await menu(t, { name: "Scones", axes: [] });
    const orderId = await anOrder(t, [withAxes, without]);

    const data = await t.query(api.feedback.byToken, {
      token: await tokenFor(t, orderId),
    });
    // The form grows only where she has done the work to make it mean
    // something. Scones are on the order and are not asked about.
    expect(data!.items.map((i) => i.name)).toEqual(["Brownies"]);
  });

  test("an invoice token is refused before the index is even scanned", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);
    const invoiceToken = await t.run(
      async (ctx) => (await ctx.db.get(orderId))!.invoiceToken,
    );
    expect(await t.query(api.feedback.byToken, { token: invoiceToken })).toBeNull();
    expect(await submit(t, { token: invoiceToken, perItem: [], flags: ["lovedIt"] }))
      .toEqual({ ok: false, reason: "unknown" });
  });

  test("ACCEPTANCE: one customer submission per order, ever", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);
    const token = await tokenFor(t, orderId);

    expect(
      await submit(t, {
        token,
        perItem: [{ menuItemId: brownie, axisRatings: [{ axis: "sweetness", value: 2 }] }],
        flags: ["lovedIt"],
        freeText: "Lovely.",
      }),
    ).toEqual({ ok: true });

    // A forwarded or re-opened link writes nothing.
    expect(await submit(t, { token, perItem: [], flags: ["late"] })).toEqual({
      ok: false,
      reason: "alreadySent",
    });

    const rows = await t.run(async (ctx) => ctx.db.query("feedback").collect());
    expect(rows.filter((r) => r.source === "customer")).toHaveLength(2); // order-level + one item
    expect(rows.some((r) => r.flags.includes("late"))).toBe(false);

    // And the form now shows the thank-you rather than a fresh set of sliders.
    expect((await t.query(api.feedback.byToken, { token }))!.alreadySent).toBe(true);

    // Her own logging is NOT bounded by this — she keeps writing notes.
    await t.withIdentity(OWNER).mutation(api.feedback.log, {
      ...SLUG,
      orderId,
      freeText: "Rang later to say the same.",
    });
    expect(
      (await t.withIdentity(OWNER).query(api.feedback.forOrder, { ...SLUG, orderId }))
        .entries,
    ).toHaveLength(3);
  });

  test("ACCEPTANCE: a token cannot write into another order's item", async () => {
    const t = await kitchen();
    const brownie = await menu(t, { name: "Brownies" });
    const scones = await menu(t, { name: "Scones" });
    const orderA = await anOrder(t, [brownie]);
    await anOrder(t, [scones], "+263715550999");

    // Scones are on order B. This token belongs to order A.
    expect(
      await submit(t, {
        token: await tokenFor(t, orderA),
        perItem: [{ menuItemId: scones, axisRatings: [{ axis: "sweetness", value: 2 }] }],
        flags: [],
      }),
    ).toEqual({ ok: false, reason: "unknown" });
    expect(await t.run(async (ctx) => ctx.db.query("feedback").collect())).toHaveLength(0);
  });

  test("out-of-range and off-item ratings are refused, and nothing is written", async () => {
    const t = await kitchen();
    const brownie = await menu(t, { axes: ["sweetness", "moisture"] });
    const orderId = await anOrder(t, [brownie]);
    const token = await tokenFor(t, orderId);

    const tampered: (typeof api.feedback.submit)["_args"]["perItem"][number]["axisRatings"][] = [
      [{ axis: "sweetness", value: 3 }], // off the scale
      [{ axis: "sweetness", value: 1.5 }], // between buckets
      [{ axis: "heat", value: 1 }], // not one of this item's axes
    ];
    for (const axisRatings of tampered) {
      expect(await submit(t, { token, perItem: [{ menuItemId: brownie, axisRatings }], flags: [] }))
        .toEqual({ ok: false, reason: "unknown" });
    }
    expect(await t.run(async (ctx) => ctx.db.query("feedback").collect())).toHaveLength(0);

    // The valid neighbour still works, so the guard is not just refusing
    // everything.
    expect(
      await submit(t, {
        token,
        perItem: [{ menuItemId: brownie, axisRatings: [{ axis: "sweetness", value: 2 }] }],
        flags: [],
      }),
    ).toEqual({ ok: true });
  });

  test("an empty submission is refused rather than counted as a response", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);
    expect(
      await submit(t, {
        token: await tokenFor(t, orderId),
        perItem: [{ menuItemId: brownie, axisRatings: [] }],
        flags: [],
        freeText: "   ",
      }),
    ).toEqual({ ok: false, reason: "empty" });
    expect(await t.run(async (ctx) => ctx.db.query("feedback").collect())).toHaveLength(0);
  });

  test("free text is capped so the field cannot be used as storage", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);
    await submit(t, {
      token: await tokenFor(t, orderId),
      perItem: [],
      flags: [],
      freeText: "x".repeat(5_000),
    });
    const [row] = await t.run(async (ctx) => ctx.db.query("feedback").collect());
    expect(row.freeText).toHaveLength(500);
  });

  test("a cancelled order is not asked about", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await anOrder(t, [brownie]);
    const token = await tokenFor(t, orderId);
    await t
      .withIdentity(OWNER)
      .mutation(api.orders.cancel, { ...SLUG, orderId, reason: "Called off." });

    expect(await t.query(api.feedback.byToken, { token })).toBeNull();
    expect(await submit(t, { token, perItem: [], flags: ["lovedIt"] })).toEqual({
      ok: false,
      reason: "unknown",
    });
  });
});

describe("the readout", () => {
  test("it reaches the menu item and reports both directions and the provenance", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const asOwner = t.withIdentity(OWNER);

    for (const value of [2, 2, -2]) {
      const orderId = await anOrder(t, [brownie]);
      await asOwner.mutation(api.feedback.log, {
        ...SLUG,
        orderId,
        menuItemId: brownie,
        axisRatings: [{ axis: "sweetness", value }],
      });
    }

    const readout = await asOwner.query(api.feedback.forMenuItem, {
      ...SLUG,
      menuItemId: brownie,
    });
    const sweetness = readout.summary.axes.find((a) => a.axis === "sweetness")!;
    expect(sweetness.sentence).toBe("2 of 3 said too sweet. 1 said not sweet enough.");
    expect(sweetness.splitBothWays).toBe(true);
    expect(readout.summary.provenance).toBe(
      "All 3 are your own notes — nobody has used the form yet.",
    );
  });

  test("too small reaches the optimiser as a warning that names its source", async () => {
    const t = await kitchen();
    const brownie = await menu(t, { axes: ["sweetness", "portionSize"] });
    const asOwner = t.withIdentity(OWNER);
    for (const value of [-2, -1]) {
      const orderId = await anOrder(t, [brownie]);
      await asOwner.mutation(api.feedback.log, {
        ...SLUG,
        orderId,
        menuItemId: brownie,
        axisRatings: [{ axis: "portionSize", value }],
      });
    }
    const { warnings } = await asOwner.query(api.feedback.forMenuItem, {
      ...SLUG,
      menuItemId: brownie,
    });
    expect(warnings.map((w) => w.kind)).toEqual(["portionTooSmall"]);
    expect(warnings[0].detail).toContain("2 of the last 2 said it was too small");
    expect(warnings[0].detail).toContain("your own notes");
  });
});
