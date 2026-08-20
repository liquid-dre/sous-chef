import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Alerts, end to end through the real functions.
 *
 * The tests that carry the slice: an order for Friday raises on the correct
 * day; resolving one of seven leaves the other six and the badge at six; a
 * muted ingredient raises nothing and is still visibly listed; and a stale
 * pantry cannot raise a red at all. That last one is the rule CONTEXT.md says
 * protects the whole feature — two wrong reds and she mutes the system
 * forever.
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

/** Wednesday. The horizon runs to Tuesday 11 Aug inclusive. */
const TODAY = "2026-08-05";
const FRIDAY = "2026-08-07";
const FAR = "2026-08-20"; // outside the seven days
const KG = 1_000_000;

async function kitchen() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  const asSuper = t.withIdentity({ subject: "user_super" });
  await asSuper.mutation(api.admin.provisionOrg, {
    orgId: "org_kitchen_a",
    slug: "kitchen-a",
    name: "Kitchen A",
  });
  await asSuper.mutation(api.admin.provisionOrg, {
    orgId: "org_kitchen_b",
    slug: "kitchen-b",
    name: "Kitchen B",
  });
  await t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
    ...SLUG,
    overheadRateCentsPerHour: 800,
    deliveryFeeModel: "flat",
    deliveryFeeConfig: { flatCents: 0 },
    stocktakeDay: 3, // Wednesday
  });
  return t;
}

async function ingredient(
  t: ReturnType<typeof convexTest>,
  name: string,
  opts: { trackStock?: boolean } = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: "org_kitchen_a",
      name,
      baseUnit: "g" as const,
      standardCostCentsPerThousand: 185,
      standardCostSetAt: Date.now(),
      trackStock: opts.trackStock ?? true,
      alertsMuted: false,
    }),
  );
}

/** Stock arrives the only way it can: as a movement. */
async function stockUp(
  t: ReturnType<typeof convexTest>,
  ingredientId: Id<"ingredients">,
  qtyMilli: number,
) {
  await t.run(async (ctx) =>
    ctx.db.insert("stockMovements", {
      orgId: "org_kitchen_a",
      ingredientId,
      deltaMilli: qtyMilli,
      reason: "purchase" as const,
      occurredAt: Date.now() - 86_400_000,
    }),
  );
}

/** Brownies: 12 a batch, 500 g flour. Deliberately NO sub-recipe here — the
 * nested path is proved exhaustively in convex/lib/requirements.test.ts. */
async function menu(t: ReturnType<typeof convexTest>) {
  const flour = await ingredient(t, "Flour");
  const { menuItemId } = await t.withIdentity(OWNER).mutation(api.menuItems.save, {
    ...SLUG,
    name: "Brownies",
    notSoldDirectly: false,
    baseBatchYield: 12,
    unitWeightMilligrams: 85_000,
    batchProductionMinutes: 60,
    perUnitExtras: [],
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
  return { flour: flour as Id<"ingredients">, brownie: menuItemId as Id<"menuItems"> };
}

async function orderFor(
  t: ReturnType<typeof convexTest>,
  brownie: Id<"menuItems">,
  units: number,
  deliveryDate = FRIDAY,
  phone = "+263715550184",
) {
  const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
    ...SLUG,
    phone,
    name: "Tariro Moyo",
    orderDate: TODAY,
    deliveryDate,
    lines: [{ menuItemId: brownie, qtyMilli: units * 1000 }],
  });
  return orderId;
}

const listAlerts = (t: ReturnType<typeof convexTest>, today = TODAY) =>
  t.withIdentity(OWNER).query(api.alerts.list, { ...SLUG, today });

/** The clock is frozen so `producedAt`/`occurredAt` comparisons are stable
 * whatever time of day the suite runs — the lesson production.test.ts learned
 * when it went red overnight having changed nothing. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00Z`));
  vi.unstubAllEnvs();
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
});
afterEach(() => vi.useRealTimers());

describe("looking forward at the order book", () => {
  test("ACCEPTANCE: an order for Friday raises on the correct day", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000); // 200 g — nowhere near enough

    // Nothing booked yet: nothing to be short OF.
    expect((await listAlerts(t)).open).toHaveLength(0);

    // 24 brownies on Friday = 2 batches = 1 kg of flour. She has 200 g.
    await orderFor(t, brownie, 24, FRIDAY);
    const withOrder = await listAlerts(t);
    expect(withOrder.open).toHaveLength(1);
    expect(withOrder.open[0].name).toBe("Flour");
    expect(withOrder.open[0].shortfallMilli).toBe(800_000);
    // The sentence's demand half, as facts rather than prose.
    expect(withOrder.orderCount).toBe(1);
    expect(withOrder.demandBatches).toBe(2);
    expect(withOrder.horizonEnd).toBe("2026-08-11");
  });

  test("ACCEPTANCE: the shortfall is found with ZERO usage history", async () => {
    // This is what "the order book sets red" buys: no weeks of consumption
    // exist, so there is no typical week to compare against, and the alert
    // fires anyway because it is arithmetic on orders she has already taken.
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FRIDAY);

    const movements = await t.run(async (ctx) =>
      ctx.db
        .query("stockMovements")
        .filter((q) => q.eq(q.field("reason"), "production"))
        .collect(),
    );
    expect(movements).toHaveLength(0); // nothing has ever been made
    expect((await listAlerts(t)).open).toHaveLength(1);
  });

  test("the two rules COMPOSE: red is computed, then demoted until she counts", async () => {
    // Decision 3 says the order book sets red; decision 5 says a pantry
    // nobody has ever counted cannot carry one. Both apply, in that order —
    // so a brand-new kitchen sees the shortfall as amber, and earns its first
    // red by taking one stocktake. That is deliberate: red compares the order
    // book against the STOCK figure, and an unconfirmed figure is exactly
    // what a wrong red would be built on.
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FRIDAY);

    expect((await listAlerts(t)).open[0].severity).toBe("amber");

    await t.withIdentity(OWNER).mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 200_000 }],
    });
    expect((await listAlerts(t)).open[0].severity).toBe("red");
  });

  test("ACCEPTANCE: an order outside the seven days raises nothing yet", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FAR);

    const list = await listAlerts(t);
    expect(list.open).toHaveLength(0);
    expect(list.orderCount).toBe(0);

    // …and it appears once the window reaches it. 20 Aug is a Thursday, so
    // asking on the 15th brings it inside.
    const later = await listAlerts(t, "2026-08-15");
    expect(later.open).toHaveLength(1);
  });

  test("a cancelled order is not demand", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    const orderId = await orderFor(t, brownie, 24, FRIDAY);
    expect((await listAlerts(t)).open).toHaveLength(1);

    await t.withIdentity(OWNER).mutation(api.orders.cancel, {
      ...SLUG,
      orderId,
      reason: "She changed her mind.",
    });
    expect((await listAlerts(t)).open).toHaveLength(0);
  });

  test("plenty of stock is silent", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 50 * KG);
    await orderFor(t, brownie, 24, FRIDAY);
    expect((await listAlerts(t)).open).toHaveLength(0);
  });

  test("a don't-track-stock ingredient never alerts and never appears", async () => {
    // Salt, water, foil: costed, never counted (CONTEXT.md — Pantry).
    const t = await kitchen();
    const salt = await ingredient(t, "Salt", { trackStock: false });
    const { menuItemId } = await t.withIdentity(OWNER).mutation(api.menuItems.save, {
      ...SLUG,
      name: "Pretzels",
      notSoldDirectly: false,
      baseBatchYield: 10,
      unitWeightMilligrams: 50_000,
      batchProductionMinutes: 30,
      perUnitExtras: [],
      priceCents: 200,
      shelfLifeHours: 48,
      lines: [
        {
          componentType: "ingredient" as const,
          componentId: salt,
          qtyMilli: 900_000,
          unit: "g" as const,
        },
      ],
    });
    await orderFor(t, menuItemId as Id<"menuItems">, 20, FRIDAY);
    const list = await listAlerts(t);
    expect(list.open).toHaveLength(0);
    expect(list.runways.some((r) => r.name === "Salt")).toBe(false);
  });
});

describe("resolving", () => {
  /** Seven ingredients, each short for the same Friday order. */
  async function sevenShortfalls(t: ReturnType<typeof convexTest>) {
    const names = ["Flour", "Butter", "Sugar", "Cocoa", "Milk", "Eggs", "Salt"];
    const ids: Id<"ingredients">[] = [];
    for (const name of names) {
      const id = await ingredient(t, name);
      await stockUp(t, id, 100_000); // 100 g of everything
      ids.push(id as Id<"ingredients">);
    }
    const { menuItemId } = await t.withIdentity(OWNER).mutation(api.menuItems.save, {
      ...SLUG,
      name: "Everything Cake",
      notSoldDirectly: false,
      baseBatchYield: 10,
      unitWeightMilligrams: 100_000,
      batchProductionMinutes: 60,
      perUnitExtras: [],
      priceCents: 500,
      shelfLifeHours: 48,
      lines: ids.map((componentId) => ({
        componentType: "ingredient" as const,
        componentId,
        qtyMilli: 1 * KG,
        unit: "g" as const,
      })),
    });
    await orderFor(t, menuItemId as Id<"menuItems">, 10, FRIDAY);
    return ids;
  }

  test("ACCEPTANCE: resolving 3 of 7 leaves six, and the badge reads 6", async () => {
    const t = await kitchen();
    await sevenShortfalls(t);
    const asOwner = t.withIdentity(OWNER);

    const before = await listAlerts(t);
    expect(before.open).toHaveLength(7);

    // The one in the middle, not the first or last.
    const third = before.open[2];
    await asOwner.mutation(api.alerts.resolve, {
      ...SLUG,
      subjectKey: third.subjectKey,
      subjectId: third.subjectId,
      type: third.type,
      severity: third.severity,
      message: `${third.name} is short`,
      shortfallMilli: third.shortfallMilli,
    });

    const after = await listAlerts(t);
    expect(after.open).toHaveLength(6);
    // The other six are untouched — same subjects, none collaterally cleared.
    expect(after.open.map((a) => a.subjectKey).sort()).toEqual(
      before.open
        .filter((a) => a.subjectKey !== third.subjectKey)
        .map((a) => a.subjectKey)
        .sort(),
    );
    const badge = await asOwner.query(api.alerts.unresolvedCount, {
      ...SLUG,
      today: TODAY,
    });
    expect(badge.count).toBe(6);
  });

  test("the resolved one is retained as history and can be undone", async () => {
    const t = await kitchen();
    await sevenShortfalls(t);
    const asOwner = t.withIdentity(OWNER);
    const alert = (await listAlerts(t)).open[0];

    const alertId = await asOwner.mutation(api.alerts.resolve, {
      ...SLUG,
      subjectKey: alert.subjectKey,
      subjectId: alert.subjectId,
      type: alert.type,
      severity: alert.severity,
      message: "Buying flour this afternoon",
      shortfallMilli: alert.shortfallMilli,
    });

    const after = await listAlerts(t);
    // The snapshot is what she SAW, not a re-derivation of today's data.
    expect(after.resolved).toHaveLength(1);
    expect(after.resolved[0].message).toBe("Buying flour this afternoon");
    expect(after.resolved[0].severity).toBe(alert.severity);
    // Still derived as live underneath, just suppressed — returned rather
    // than hidden, so the screen can say "you resolved this".
    expect(after.suppressed.map((a) => a.subjectKey)).toContain(alert.subjectKey);

    await asOwner.mutation(api.alerts.unresolve, { ...SLUG, alertId });
    const undone = await listAlerts(t);
    expect(undone.open).toHaveLength(7);
    expect(undone.resolved).toHaveLength(0);
  });

  test("a resolution holds against the same problem and yields to a worse one", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FRIDAY); // 1 kg needed, 800 g short

    const asOwner = t.withIdentity(OWNER);
    const alert = (await listAlerts(t)).open[0];
    await asOwner.mutation(api.alerts.resolve, {
      ...SLUG,
      subjectKey: alert.subjectKey,
      subjectId: alert.subjectId,
      type: alert.type,
      severity: alert.severity,
      message: "Buying flour",
      shortfallMilli: alert.shortfallMilli,
    });
    expect((await listAlerts(t)).open).toHaveLength(0);

    // A second order makes the shortfall materially worse. She resolved the
    // problem she was shown, not every flour problem this kitchen will have.
    await orderFor(t, brownie, 24, FRIDAY, "+263772119003");
    expect((await listAlerts(t)).open).toHaveLength(1);
  });
});

describe("muting", () => {
  test("ACCEPTANCE: a muted ingredient raises nothing and is listed as muted", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FRIDAY);
    const asOwner = t.withIdentity(OWNER);
    expect((await listAlerts(t)).open).toHaveLength(1);

    await asOwner.mutation(api.orgs.setIngredientAlertMute, {
      ...SLUG,
      ingredientId: flour,
      muted: true,
    });

    const list = await listAlerts(t);
    expect(list.open).toHaveLength(0);
    // Visibly listed, never silently gone — a mute she cannot see is a bug
    // she will spend an afternoon looking for.
    expect(list.mutedIngredients.map((i) => i.name)).toEqual(["Flour"]);
    expect(list.runways.find((r) => r.name === "Flour")?.muted).toBe(true);
  });

  test("ACCEPTANCE: the global cord silences everything and says so", async () => {
    // orgs.alertsMuted has existed since provisioning and suppressed nothing.
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FRIDAY);
    const asOwner = t.withIdentity(OWNER);

    await asOwner.mutation(api.alerts.setGlobalMute, { ...SLUG, muted: true });
    const list = await listAlerts(t);
    expect(list.open).toHaveLength(0);
    expect(list.globallyMuted).toBe(true);

    await asOwner.mutation(api.alerts.setGlobalMute, { ...SLUG, muted: false });
    expect((await listAlerts(t)).open).toHaveLength(1);
  });
});

describe("degradation", () => {
  test("ACCEPTANCE: a stale pantry suppresses red entirely", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    const asOwner = t.withIdentity(OWNER);

    // TWO orders, because the horizons are disjoint: asking on the 5th sees
    // 05–11, asking on the 13th sees 13–19. One order cannot sit in both.
    await orderFor(t, brownie, 24, FRIDAY);
    await orderFor(t, brownie, 24, "2026-08-14", "+263772119003");

    // Counted today → fresh → red.
    await asOwner.mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 200_000 }],
    });
    const fresh = await listAlerts(t);
    expect(fresh.trust).toBe("trusted");
    expect(fresh.open[0].severity).toBe("red");

    // A Wednesday later the count has been missed once → hedged. The
    // shortfall is just as real, but the STOCK figure it rests on is not.
    const stale = await listAlerts(t, "2026-08-13");
    expect(stale.trust).toBe("hedged");
    expect(stale.open[0].severity).toBe("amber");
    // The supply half carries its age; the demand half never hedges.
    expect(stale.open[0].staleDays).toBe(8);
    expect(stale.demandBatches).toBe(2);
  });

  test("ACCEPTANCE: dormant raises nothing per ingredient", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, "2026-08-22");
    await t.withIdentity(OWNER).mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 200_000 }],
    });

    // Two Wednesdays missed. The screen replaces the list with one line.
    const dormant = await listAlerts(t, "2026-08-20");
    expect(dormant.trust).toBe("dormant");
    expect(dormant.open).toHaveLength(0);
    // The runway rows survive so the chart can still be drawn, desaturated.
    expect(dormant.runways.length).toBeGreaterThan(0);
  });

  test("a kitchen that has never counted is hedged, not trusted", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FRIDAY);
    const list = await listAlerts(t);
    expect(list.confidence.state).toBe("neverCounted");
    expect(list.trust).toBe("hedged");
    expect(list.open[0].severity).toBe("amber");
  });
});

describe("access", () => {
  test("staff reach none of it", async () => {
    const t = await kitchen();
    const asStaff = t.withIdentity(STAFF);
    await expect(
      asStaff.query(api.alerts.list, { ...SLUG, today: TODAY }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      asStaff.query(api.alerts.unresolvedCount, { ...SLUG, today: TODAY }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      asStaff.mutation(api.alerts.setGlobalMute, { ...SLUG, muted: true }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("another kitchen sees none of this one's alerts", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FRIDAY);

    const theirs = await t
      .withIdentity(OTHER)
      .query(api.alerts.list, { orgSlug: "kitchen-b", today: TODAY });
    expect(theirs.open).toHaveLength(0);
    expect(theirs.runways).toHaveLength(0);
  });

  test("resolving another kitchen's alert is a NOT_FOUND", async () => {
    const t = await kitchen();
    await menu(t);
    const asOwner = t.withIdentity(OWNER);
    const alertId = await asOwner.mutation(api.alerts.resolve, {
      ...SLUG,
      subjectKey: "ingredient:x",
      type: "stockShort",
      severity: "red",
      message: "mine",
      shortfallMilli: 1,
    });
    await expect(
      t
        .withIdentity(OTHER)
        .mutation(api.alerts.unresolve, { orgSlug: "kitchen-b", alertId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});

describe("the digest", () => {
  test("carries the day's alerts and the trust state, once", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FRIDAY);

    const digest = await t
      .withIdentity(OWNER)
      .query(api.alerts.digest, { ...SLUG, today: TODAY });
    expect(digest.kitchenName).toBe("Kitchen A");
    expect(digest.orderCount).toBe(1);
    expect(digest.demandBatches).toBe(2);
    expect(digest.alerts).toHaveLength(1);
    expect(digest.alerts[0].name).toBe("Flour");
    expect(digest.alerts[0].shortfallMilli).toBe(800_000);
    expect(digest.trust).toBe("hedged");
  });

  test("a resolved alert is not in the digest either", async () => {
    const t = await kitchen();
    const { brownie, flour } = await menu(t);
    await stockUp(t, flour, 200_000);
    await orderFor(t, brownie, 24, FRIDAY);
    const asOwner = t.withIdentity(OWNER);
    const alert = (await listAlerts(t)).open[0];
    await asOwner.mutation(api.alerts.resolve, {
      ...SLUG,
      subjectKey: alert.subjectKey,
      subjectId: alert.subjectId,
      type: alert.type,
      severity: alert.severity,
      message: "Handled",
      shortfallMilli: alert.shortfallMilli,
    });
    const digest = await asOwner.query(api.alerts.digest, { ...SLUG, today: TODAY });
    expect(digest.alerts).toHaveLength(0);
  });
});
