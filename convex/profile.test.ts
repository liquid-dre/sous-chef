import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Business Profile slice acceptance (see plan):
 * - onboarding stamps onboardedAt once, and only once;
 * - tax is freely editable until the FIRST order exists, then requires the
 *   stamped confirm — enforced server-side, computed, never a stale flag;
 * - staff never reach the profile;
 * - per-ingredient alert mutes are org-scoped.
 */

const OWNER = {
  subject: "user_owner",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:admin",
};

const STAFF = {
  subject: "user_staff",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:member",
};

const SLUG = { orgSlug: "kitchen-a" };

async function provisioned() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  await t
    .withIdentity({ subject: "user_super" })
    .mutation(api.admin.provisionOrg, {
      orgId: "org_kitchen_a",
      slug: "kitchen-a",
      name: "Kitchen A",
    });
  return t;
}

/** Minimal valid order row — the order mutations don't exist yet, so the
 * "first order" condition is produced directly. */
async function insertOrder(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const customerId = await ctx.db.insert("customers", {
      orgId: "org_kitchen_a",
      name: "Rutendo M.",
      phone: "+263770000000",
      marketingConsent: true,
      consentSource: "order",
    });
    await ctx.db.insert("orders", {
      orgId: "org_kitchen_a",
      customerId,
      orderDate: "2026-08-01",
      deliveryDate: "2026-08-02",
      status: "confirmed",
      deliveryFeeCents: 0,
      deliveryCostCents: 0,
      discountCents: 0,
      taxInclusiveAtCreation: false,
      taxRateBpAtCreation: 0,
      invoiceNumber: 1,
      revision: 0,
      source: "app",
      feedbackToken: "fb_token_1",
      invoiceToken: "inv_token_1",
    });
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("onboarding", () => {
  test("completes once, stamps onboardedAt, and refuses a second run", async () => {
    const t = await provisioned();
    const asOwner = t.withIdentity(OWNER);

    let profile = await asOwner.query(api.orgs.getProfile, SLUG);
    expect(profile.onboarded).toBe(false);

    await asOwner.mutation(api.orgs.completeOnboarding, {
      ...SLUG,
      name: "Rutendo's Kitchen",
      palette: { primary: "#2E6158", accent: "#B56E3C" },
      stocktakeDay: 0,
    });

    profile = await asOwner.query(api.orgs.getProfile, SLUG);
    expect(profile.onboarded).toBe(true);
    expect(profile.name).toBe("Rutendo's Kitchen");
    expect(profile.stocktakeDay).toBe(0);

    await expect(
      asOwner.mutation(api.orgs.completeOnboarding, {
        ...SLUG,
        name: "Again",
        palette: { primary: "#2E6158" },
        stocktakeDay: 1,
      }),
    ).rejects.toThrow("already set up");
  });

  test("rejects an invalid colour and an invalid weekday", async () => {
    const t = await provisioned();
    const asOwner = t.withIdentity(OWNER);
    await expect(
      asOwner.mutation(api.orgs.completeOnboarding, {
        ...SLUG,
        name: "K",
        palette: { primary: "teal" },
        stocktakeDay: 0,
      }),
    ).rejects.toThrow("not a colour");
    await expect(
      asOwner.mutation(api.orgs.completeOnboarding, {
        ...SLUG,
        name: "K",
        palette: { primary: "#2E6158" },
        stocktakeDay: 7,
      }),
    ).rejects.toThrow("weekday");
  });
});

describe("updateProfile", () => {
  test("patches only what's sent and validates ranges", async () => {
    const t = await provisioned();
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.orgs.updateProfile, {
      ...SLUG,
      invoicePrefix: "RK",
      paymentInstructions: "EcoCash 0770 000 000 (Rutendo M.)",
      defaultDepositPercent: 50,
    });
    const profile = await asOwner.query(api.orgs.getProfile, SLUG);
    expect(profile.invoicePrefix).toBe("RK");
    expect(profile.defaultDepositPercent).toBe(50);
    expect(profile.name).toBe("Kitchen A"); // untouched

    await expect(
      asOwner.mutation(api.orgs.updateProfile, {
        ...SLUG,
        defaultDepositPercent: 101,
      }),
    ).rejects.toThrow("between 0 and 100");
  });

  test("staff are rejected at the server", async () => {
    const t = await provisioned();
    const asStaff = t.withIdentity(STAFF);
    await expect(asStaff.query(api.orgs.getProfile, SLUG)).rejects.toMatchObject(
      { data: { code: "FORBIDDEN" } },
    );
    await expect(
      asStaff.mutation(api.orgs.updateProfile, { ...SLUG, name: "Hijack" }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });
});

describe("tax lock", () => {
  test("ACCEPTANCE: freely editable before the first order, locked behind the confirm after — and not before", async () => {
    const t = await provisioned();
    const asOwner = t.withIdentity(OWNER);

    // No orders: edits flow with no confirm.
    await asOwner.mutation(api.orgs.updateTax, {
      ...SLUG,
      taxEnabled: true,
      taxRateBp: 1550,
    });
    let profile = await asOwner.query(api.orgs.getProfile, SLUG);
    expect(profile.taxEnabled).toBe(true);
    expect(profile.hasAnyOrder).toBe(false);

    // First order arrives.
    await insertOrder(t);
    profile = await asOwner.query(api.orgs.getProfile, SLUG);
    expect(profile.hasAnyOrder).toBe(true);

    // Now a change without the stamped confirm is refused...
    await expect(
      asOwner.mutation(api.orgs.updateTax, { ...SLUG, taxInclusive: true }),
    ).rejects.toMatchObject({ data: { code: "TAX_LOCKED" } });

    // ...and with it, allowed.
    await asOwner.mutation(api.orgs.updateTax, {
      ...SLUG,
      taxInclusive: true,
      confirmStamped: true,
    });
    profile = await asOwner.query(api.orgs.getProfile, SLUG);
    expect(profile.taxInclusive).toBe(true);
  });

  test("a no-op write never triggers the lock", async () => {
    const t = await provisioned();
    await insertOrder(t);
    const asOwner = t.withIdentity(OWNER);
    // Same values as stored: not a change, no confirm needed.
    await expect(
      asOwner.mutation(api.orgs.updateTax, { ...SLUG, taxEnabled: false }),
    ).resolves.toBeNull();
  });
});

describe("ingredient alert mutes", () => {
  test("roundtrips within the org and 404s across orgs", async () => {
    const t = await provisioned();
    const ingredientId = await t.run(async (ctx) =>
      ctx.db.insert("ingredients", {
        orgId: "org_kitchen_a",
        name: "Milk",
        baseUnit: "ml",
        standardCostCentsPerThousand: 120,
        standardCostSetAt: 1,
        trackStock: true,
        alertsMuted: false,
      }),
    );
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.orgs.setIngredientAlertMute, {
      ...SLUG,
      ingredientId,
      muted: true,
    });
    const muted = await t.run(async (ctx) => (await ctx.db.get(ingredientId))!.alertsMuted);
    expect(muted).toBe(true);

    const intruder = t.withIdentity({
      subject: "user_b",
      org_id: "org_kitchen_b",
      org_slug: "kitchen-b",
      org_role: "org:admin",
    });
    await expect(
      intruder.mutation(api.orgs.setIngredientAlertMute, {
        orgSlug: "kitchen-b",
        ingredientId,
        muted: false,
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});
