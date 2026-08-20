import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * The calendar, end to end.
 *
 * The test that carries the slice is the staff payload one. This is the
 * screen staff LAND on (`app/[orgSlug]/(app)/page.tsx:28` redirects them
 * here), so it is the single most likely place for a cost to leak to a role
 * that must never see one — DESIGN.md's NEVER SHIP list, item four. It is
 * asserted twice over: against the serialised payload, which survives
 * refactors a type check would not, AND against the key set, because
 * `something: null` is a field PRESENT and the acceptance criterion says no
 * cost or price field may be present at all.
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

/** 2026-08-03 Mon … 2026-08-09 Sun. Friday is the 7th. */
const TODAY = "2026-08-03";
const WEEK = { start: "2026-08-03", end: "2026-08-09" };
const THURSDAY = "2026-08-06";
const FRIDAY = "2026-08-07";
const SATURDAY = "2026-08-08";

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
    productionHoursPerDay: 8,
  });
  return t;
}

/**
 * Brownies: 12 a batch, 60 min, 3-day lead time, 72h shelf life.
 * The lead time is what makes the Friday → Tuesday acceptance case bite.
 */
async function menu(
  t: ReturnType<typeof convexTest>,
  over: { leadTimeHours?: number; shelfLifeHours?: number; batchProductionMinutes?: number } = {},
) {
  const { menuItemId } = await t.withIdentity(OWNER).mutation(api.menuItems.save, {
    ...SLUG,
    name: "Brownies",
    notSoldDirectly: false,
    baseBatchYield: 12,
    unitWeightMilligrams: 85_000,
    batchProductionMinutes: over.batchProductionMinutes ?? 60,
    perUnitExtras: [],
    priceCents: 300,
    leadTimeHours: over.leadTimeHours ?? 72,
    shelfLifeHours: over.shelfLifeHours ?? 72,
    lines: [],
  });
  return menuItemId as Id<"menuItems">;
}

async function orderFor(
  t: ReturnType<typeof convexTest>,
  menuItemId: Id<"menuItems">,
  units: number,
  deliveryDate: string,
  over: { phone?: string; name?: string } = {},
) {
  const { orderId } = await t.withIdentity(OWNER).mutation(api.orders.create, {
    ...SLUG,
    phone: over.phone ?? "+263715550184",
    name: over.name ?? "Tariro Moyo",
    orderDate: TODAY,
    deliveryDate,
    lines: [{ menuItemId, qtyMilli: units * 1000 }],
  });
  return orderId;
}

const asRole = (t: ReturnType<typeof convexTest>, who: typeof OWNER) =>
  t.withIdentity(who).query(api.calendar.range, { ...SLUG, ...WEEK, today: TODAY });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00Z`));
  vi.unstubAllEnvs();
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
});
afterEach(() => vi.useRealTimers());

describe("what lands on the calendar", () => {
  test("ACCEPTANCE: a 3-day lead time on a Friday order prompts on Tuesday", () => {
    // The pure arithmetic is pinned in convex/lib/schedule.test.ts; this is
    // the same claim through the real query, with a real order.
    return kitchen().then(async (t) => {
      const brownie = await menu(t);
      await orderFor(t, brownie, 12, FRIDAY);

      const cal = await asRole(t, OWNER);
      expect(cal.prompts).toHaveLength(1);
      expect(cal.prompts[0].startDay).toBe("2026-08-04"); // Tuesday
      expect(cal.prompts[0].firstDeliveryDay).toBe(FRIDAY);
      expect(cal.prompts[0].batchCount).toBe(1);
      // And the delivery itself is on the calendar on its own day.
      expect(cal.due).toHaveLength(1);
      expect(cal.due[0].deliveryDay).toBe(FRIDAY);
      expect(cal.due[0].summary).toBe("12 × Brownies");
    });
  });

  test("ACCEPTANCE: two Thursday orders for one item make ONE prompt", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await orderFor(t, brownie, 12, THURSDAY);
    await orderFor(t, brownie, 12, THURSDAY, {
      phone: "+263772119003",
      name: "Rudo",
    });

    const cal = await asRole(t, OWNER);
    expect(cal.prompts).toHaveLength(1);
    expect(cal.prompts[0].covers).toHaveLength(2);
    expect(cal.prompts[0].batchCount).toBe(2); // 24 units, 12 to a batch
    // Two deliveries, still two rows on the calendar — consolidation is about
    // the BAKE, never about hiding an order.
    expect(cal.due).toHaveLength(2);
  });

  test("shelf life decides whether Thursday and Saturday share a batch", async () => {
    // Lead time held at one day so the start sits just before the first
    // delivery; only the shelf life differs between the two kitchens.
    const t = await kitchen();
    const brownie = await menu(t, { shelfLifeHours: 72, leadTimeHours: 24 });
    await orderFor(t, brownie, 12, THURSDAY);
    await orderFor(t, brownie, 12, SATURDAY, {
      phone: "+263772119003",
      name: "Rudo",
    });
    expect((await asRole(t, OWNER)).prompts).toHaveLength(1);

    // A 24-hour item cannot reach across, and prompting once would tell her
    // to serve two-day-old food.
    const t2 = await kitchen();
    const bun = await menu(t2, { shelfLifeHours: 24, leadTimeHours: 24 });
    await orderFor(t2, bun, 12, THURSDAY);
    await orderFor(t2, bun, 12, SATURDAY, {
      phone: "+263772119003",
      name: "Rudo",
    });
    expect((await asRole(t2, OWNER)).prompts).toHaveLength(2);
  });

  test("a long lead time can defeat consolidation, and that is correct", async () => {
    // Lead time 72h and shelf life 72h: the Thursday batch must start on the
    // Monday, so by Saturday it is five days old and cannot cover a second
    // delivery. Sous prompts twice.
    //
    // This is a real consequence of taking the LATER of lead time and bake
    // duration, and it is the honest answer rather than a rounding artefact —
    // food started that early genuinely does not survive that long. If it
    // ever reads wrong on screen, the fix is her lead time, not this rule.
    const t = await kitchen();
    const brownie = await menu(t, { leadTimeHours: 72, shelfLifeHours: 72 });
    await orderFor(t, brownie, 12, THURSDAY);
    await orderFor(t, brownie, 12, SATURDAY, {
      phone: "+263772119003",
      name: "Rudo",
    });

    const cal = await asRole(t, OWNER);
    expect(cal.prompts).toHaveLength(2);
    expect(cal.prompts[0].startDay).toBe("2026-08-03"); // Monday, for Thursday
    expect(cal.prompts[1].startDay).toBe("2026-08-05"); // Wednesday, for Saturday
  });

  test("a cancelled order leaves the calendar entirely", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await orderFor(t, brownie, 12, FRIDAY);
    expect((await asRole(t, OWNER)).due).toHaveLength(1);

    await t.withIdentity(OWNER).mutation(api.orders.cancel, {
      ...SLUG,
      orderId,
      reason: "She changed her mind.",
    });
    const cal = await asRole(t, OWNER);
    expect(cal.due).toHaveLength(0);
    expect(cal.prompts).toHaveLength(0);
  });

  test("a line already fulfilled from stock raises no prompt but stays due", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    const orderId = await orderFor(t, brownie, 12, FRIDAY);
    // Point the line at a batch, the way fulfil-from-stock does.
    await t.run(async (ctx) => {
      const line = await ctx.db
        .query("orderLines")
        .filter((q) => q.eq(q.field("orderId"), orderId))
        .first();
      const logId = await ctx.db.insert("productionLogs", {
        orgId: "org_kitchen_a",
        menuItemId: brownie,
        orderIds: [],
        batchCount: 1,
        expectedYieldMilli: 12_000,
        actualYieldMilli: 12_000,
        producedAt: Date.now(),
        producedOn: TODAY,
        cogsSnapshot: { ingredientsCents: 0, perUnitExtrasCents: 0, overheadCents: 0 },
        overhangQtyMilli: 12_000,
        overhangRemainingQtyMilli: 12_000,
        wasteQtyMilli: 0,
      });
      await ctx.db.patch(line!._id, { fulfilledFromProductionLogId: logId });
    });

    const cal = await asRole(t, OWNER);
    // The food exists, so nothing needs baking …
    expect(cal.prompts).toHaveLength(0);
    // … but she still has to hand it over on Friday.
    expect(cal.due).toHaveLength(1);
  });

  test("an order outside the window is not in it", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await orderFor(t, brownie, 12, "2026-09-20");
    const cal = await asRole(t, OWNER);
    expect(cal.due).toHaveLength(0);
  });

  test("a prompt whose start day has passed is clamped and marked overdue", async () => {
    // A Tuesday start for a Friday delivery, asked on the Thursday. The batch
    // should have gone in two days ago; letting it vanish off the top of the
    // window is how an order gets missed.
    const t = await kitchen();
    const brownie = await menu(t);
    await orderFor(t, brownie, 12, FRIDAY);

    const cal = await t.withIdentity(OWNER).query(api.calendar.range, {
      ...SLUG,
      start: THURSDAY,
      end: "2026-08-12",
      today: THURSDAY,
    });
    expect(cal.prompts).toHaveLength(1);
    expect(cal.prompts[0].overdue).toBe(true);
    expect(cal.prompts[0].startDay).toBe(THURSDAY); // clamped into view
    expect(cal.prompts[0].firstDeliveryDay).toBe(FRIDAY);
  });

  test("an empty week is an empty payload, never a crash", async () => {
    const t = await kitchen();
    const cal = await asRole(t, OWNER);
    expect(cal.due).toEqual([]);
    expect(cal.prompts).toEqual([]);
    // The stocktake still shows: it is a standing appointment, not data.
    expect(cal.stocktakeDays).toEqual(["2026-08-05"]); // the Wednesday
  });

  test("a backwards range is refused rather than returning nothing", async () => {
    const t = await kitchen();
    await expect(
      t.withIdentity(OWNER).query(api.calendar.range, {
        ...SLUG,
        start: "2026-08-09",
        end: "2026-08-03",
        today: TODAY,
      }),
    ).rejects.toThrow(/backwards/);
  });
});

describe("the staff payload", () => {
  test("ACCEPTANCE: no cost or price field is PRESENT, not merely null", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await orderFor(t, brownie, 12, FRIDAY);

    const staff = await asRole(t, STAFF);

    // 1. Nothing cost-shaped anywhere in the serialised payload. This
    //    survives refactors a type-level check would not.
    const serialised = JSON.stringify(staff);
    for (const leak of [
      "cogsSnapshot",
      "priceCents",
      "unitPriceCents",
      "totalCents",
      "valueCents",
      "roughCostCents",
      "deliveryCostCents",
      "grossMargin",
      "capacity",
    ]) {
      expect(serialised, `staff payload leaked ${leak}`).not.toContain(leak);
    }

    // 2. And the KEY is absent, not nulled. `capacity: null` would pass a
    //    value check and still be a field present, which is what the
    //    acceptance criterion forbids.
    expect(Object.keys(staff).sort()).toEqual([
      "due",
      "end",
      "prompts",
      "start",
      "stocktakeDays",
      "today",
    ]);
    expect("capacity" in staff).toBe(false);

    // 3. The owner does get it, so the omission is a role decision rather
    //    than the feature being missing.
    const owner = await asRole(t, OWNER);
    expect("capacity" in owner).toBe(true);
    expect(owner.capacity!.ceilingHours).toBe(8);
  });

  test("staff still get the three things they can act on", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await orderFor(t, brownie, 12, FRIDAY);

    const staff = await asRole(t, STAFF);
    expect(staff.due).toHaveLength(1);
    expect(staff.due[0].summary).toBe("12 × Brownies");
    expect(staff.prompts).toHaveLength(1);
    // Stocktake day is informational for them — recordStocktake is an
    // ownerMutation — but it is on the calendar, because the counting itself
    // may well be delegated.
    expect(staff.stocktakeDays).toEqual(["2026-08-05"]);
  });

  test("the charts are owner-only", async () => {
    const t = await kitchen();
    await expect(
      t.withIdentity(STAFF).query(api.calendar.density, { ...SLUG, end: TODAY }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("staff cannot reach another kitchen's calendar", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await orderFor(t, brownie, 12, FRIDAY);

    const theirs = await t
      .withIdentity(OTHER)
      .query(api.calendar.range, { orgSlug: "kitchen-b", ...WEEK, today: TODAY });
    expect(theirs.due).toHaveLength(0);
    expect(theirs.prompts).toHaveLength(0);
  });
});

describe("capacity", () => {
  test("a day over her own ceiling is flagged, and the work still shows", async () => {
    const t = await kitchen();
    // 10 hours a batch; two Thursday orders make two batches on one start day.
    const cake = await menu(t, { batchProductionMinutes: 600, leadTimeHours: 24 });
    await orderFor(t, cake, 12, THURSDAY);
    await orderFor(t, cake, 12, THURSDAY, { phone: "+263772119003", name: "Rudo" });

    const cal = await asRole(t, OWNER);
    const over = cal.capacity!.byDay.filter((d) => d.over);
    expect(over).toHaveLength(1);
    expect(over[0].hours).toBeGreaterThan(8);
    // FLAGGED, NEVER BLOCKED — the prompt is still there to be acted on.
    expect(cal.prompts).toHaveLength(1);
    expect(cal.prompts[0].batchCount).toBe(2);
  });

  test("an unset ceiling falls back to a working day rather than to zero", async () => {
    const t = await kitchen();
    await t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
      ...SLUG,
      productionHoursPerDay: null,
    });
    const brownie = await menu(t);
    await orderFor(t, brownie, 12, FRIDAY);

    const cal = await asRole(t, OWNER);
    expect(cal.capacity!.ceilingHours).toBe(8);
    // One hour of brownies is not over a working day. A zero fallback would
    // have flagged it, which is how she learns to ignore the flag.
    expect(cal.capacity!.byDay.every((d) => !d.over)).toBe(true);
  });

  test("a nonsense ceiling is refused, not clamped", async () => {
    const t = await kitchen();
    for (const hours of [0, -3, 25]) {
      await expect(
        t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
          ...SLUG,
          productionHoursPerDay: hours,
        }),
      ).rejects.toThrow(/between 1 and 24/);
    }
  });
});

describe("order density", () => {
  test("counts land on the right weekday, in whole Monday-first columns", async () => {
    const t = await kitchen();
    const brownie = await menu(t);
    await orderFor(t, brownie, 12, FRIDAY);
    await orderFor(t, brownie, 12, FRIDAY, { phone: "+263772119003", name: "Rudo" });
    await orderFor(t, brownie, 12, THURSDAY, { phone: "+263771234567", name: "Chipo" });

    const d = await t
      .withIdentity(OWNER)
      .query(api.calendar.density, { ...SLUG, end: "2026-08-09", weeks: 4 });

    expect(d.columns).toHaveLength(4);
    expect(d.columns[0].bins).toHaveLength(7);
    expect(d.orderCount).toBe(3);

    const last = d.columns[3];
    // Monday-first: index 0 is Monday, so Thursday is 3 and Friday is 4.
    expect(last.bins[3].day).toBe(THURSDAY);
    expect(last.bins[3].count).toBe(1);
    expect(last.bins[4].day).toBe(FRIDAY);
    expect(last.bins[4].count).toBe(2);
    // A dead day is a real zero, not a gap — that IS the signal.
    expect(last.bins[0].count).toBe(0);
  });
});
