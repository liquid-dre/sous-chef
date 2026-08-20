import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { ConvexError } from "convex/values";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * The acceptance tests for the tenancy boundary (CONTEXT.md — Access):
 * - a staff user hitting an owner-only function is rejected at the server;
 * - an org mismatch between route slug and JWT is a NOT_FOUND, never a
 *   confirmation the org exists;
 * - the super-user allowlist gates admin functions.
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

function freshBackend() {
  return convexTest(schema);
}

async function provision(t: ReturnType<typeof convexTest>) {
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  const asSuper = t.withIdentity({ subject: "user_super" });
  await asSuper.mutation(api.admin.provisionOrg, {
    orgId: "org_kitchen_a",
    slug: "kitchen-a",
    name: "Kitchen A",
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("withOrg", () => {
  test("unauthenticated callers are rejected", async () => {
    const t = freshBackend();
    await expect(
      t.query(api.orgs.getCurrent, { orgSlug: "kitchen-a" }),
    ).rejects.toThrow(ConvexError);
  });

  test("a member of org A asking for org B gets NOT_FOUND", async () => {
    const t = freshBackend();
    await provision(t);
    const asOwner = t.withIdentity(OWNER);
    await expect(
      asOwner.query(api.orgs.getCurrent, { orgSlug: "kitchen-b" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  test("a matching member gets their org, with orgId injected from the JWT", async () => {
    const t = freshBackend();
    await provision(t);
    const asStaff = t.withIdentity(STAFF);
    const org = await asStaff.query(api.orgs.getCurrent, {
      orgSlug: "kitchen-a",
    });
    expect(org).toMatchObject({
      orgId: "org_kitchen_a",
      role: "staff",
      slug: "kitchen-a",
      provisioned: true,
    });
  });

  test("clerk org:admin maps to owner", async () => {
    const t = freshBackend();
    await provision(t);
    const asOwner = t.withIdentity(OWNER);
    const org = await asOwner.query(api.orgs.getCurrent, {
      orgSlug: "kitchen-a",
    });
    expect(org.role).toBe("owner");
  });

  test("the tier and foundingMember never reach the org", async () => {
    const t = freshBackend();
    await provision(t);
    const asOwner = t.withIdentity(OWNER);
    const org = await asOwner.query(api.orgs.getCurrent, {
      orgSlug: "kitchen-a",
    });
    // `plan`, not `tier`. The field has always been called `plan`
    // (convex/schema.ts) and the UI calls it a tier; asserting the UI's word
    // here passed vacuously and would have kept passing if the real field
    // started leaking tomorrow.
    expect(org).not.toHaveProperty("plan");
    expect(org).not.toHaveProperty("subscriptionStatus");
    expect(org).not.toHaveProperty("foundingMember");
  });
});

describe("withOwner", () => {
  test("ACCEPTANCE: staff hitting an owner-only mutation is rejected at the server", async () => {
    const t = freshBackend();
    await provision(t);
    const asStaff = t.withIdentity(STAFF);
    await expect(
      asStaff.mutation(api.orgs.setCostDriftThreshold, {
        orgSlug: "kitchen-a",
        costDriftThresholdPercent: 15,
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("an owner passes the same gate", async () => {
    const t = freshBackend();
    await provision(t);
    const asOwner = t.withIdentity(OWNER);
    await expect(
      asOwner.mutation(api.orgs.setCostDriftThreshold, {
        orgSlug: "kitchen-a",
        costDriftThresholdPercent: 15,
      }),
    ).resolves.toBeNull();
  });
});

describe("disabled orgs", () => {
  test("a disabled org is read-only: reads work, writes are rejected", async () => {
    const t = freshBackend();
    await provision(t);
    vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
    const asSuper = t.withIdentity({ subject: "user_super" });
    await asSuper.mutation(api.admin.setDisabled, {
      orgId: "org_kitchen_a",
      disabled: true,
    });
    const asOwner = t.withIdentity(OWNER);
    const org = await asOwner.query(api.orgs.getCurrent, {
      orgSlug: "kitchen-a",
    });
    expect(org.disabled).toBe(true);
    await expect(
      asOwner.mutation(api.orgs.setCostDriftThreshold, {
        orgSlug: "kitchen-a",
        costDriftThresholdPercent: 12,
      }),
    ).rejects.toMatchObject({ data: { code: "ORG_DISABLED" } });
  });

  /**
   * ACCEPTANCE: "a disabled org's writes fail at the Convex layer, not just in
   * the interface" — including the two that never resolve an org.
   *
   * `publicMutation` is a bare alias of the raw builder, so `feedback.submit`
   * and `invoices.recordView` reach no `assertWritable` and used to write into
   * a disabled kitchen quite happily. These assert the ROW, not an error code:
   * the criterion is that nothing was written, and an implementation that
   * throws the right error while still writing would pass a code assertion.
   */
  test("ACCEPTANCE: the two public mutations refuse too, and reads still work", async () => {
    const t = freshBackend();
    await provision(t);
    vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
    const asSuper = t.withIdentity({ subject: "user_super" });

    const orderId = await t.run(async (ctx) =>
      ctx.db.insert("orders", {
        orgId: "org_kitchen_a",
        orderDate: "2026-08-06",
        deliveryDate: "2026-08-08",
        status: "delivered" as const,
        source: "app" as const,
        discountCents: 0,
        deliveryFeeCents: 0,
        deliveryCostCents: 0,
        taxRateBpAtCreation: 0,
        taxInclusiveAtCreation: false,
        revision: 0,
        // recordView needs a materialised document to stamp.
        invoiceNumber: 1,
        invoicePrefixAtInvoice: "INV",
        feedbackToken: "f_disabled_case",
        invoiceToken: "i_disabled_case",
      }),
    );

    await asSuper.mutation(api.admin.setDisabled, {
      orgId: "org_kitchen_a",
      disabled: true,
    });

    // The customer's page still READS — being disabled is between the kitchen
    // and Sous, and a stranger holding the link should not find a dead page.
    expect(
      await t.query(api.invoices.byToken, { token: "i_disabled_case" }),
    ).not.toBeNull();

    // …but neither public write lands.
    await t.mutation(api.invoices.recordView, { token: "i_disabled_case" });
    // `?? null` because t.run serialises the return value and an absent field
    // comes back as null rather than undefined.
    expect(await viewedAt(t, orderId)).toBeNull();

    const result = await t.mutation(api.feedback.submit, {
      token: "f_disabled_case",
      perItem: [],
      flags: ["lovedIt"],
    });
    expect(result.ok).toBe(false);
    expect(
      await t.run(async (ctx) => ctx.db.query("feedback").collect()),
    ).toHaveLength(0);

    // And re-enabling restores both, so this is a state rather than damage.
    await asSuper.mutation(api.admin.setDisabled, {
      orgId: "org_kitchen_a",
      disabled: false,
    });
    await t.mutation(api.invoices.recordView, { token: "i_disabled_case" });
    expect(await viewedAt(t, orderId)).toEqual(expect.any(Number));
  });
});

const viewedAt = (t: ReturnType<typeof convexTest>, orderId: Id<"orders">) =>
  t.run(async (ctx) => (await ctx.db.get(orderId))!.invoiceViewedAt ?? null);

describe("super user", () => {
  test("a user not on the allowlist gets NOT_FOUND from admin functions", async () => {
    const t = freshBackend();
    vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
    const asOwner = t.withIdentity(OWNER);
    await expect(asOwner.query(api.admin.listOrgs, {})).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });

  test("an empty allowlist rejects everyone", async () => {
    const t = freshBackend();
    vi.stubEnv("SOUS_SUPER_USER_IDS", "");
    const asSuper = t.withIdentity({ subject: "user_super" });
    await expect(asSuper.query(api.admin.listOrgs, {})).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });

  test("a listed super user passes", async () => {
    const t = freshBackend();
    vi.stubEnv("SOUS_SUPER_USER_IDS", "someone_else, user_super");
    const asSuper = t.withIdentity({ subject: "user_super" });
    await expect(asSuper.query(api.admin.listOrgs, {})).resolves.toEqual([]);
  });
});
