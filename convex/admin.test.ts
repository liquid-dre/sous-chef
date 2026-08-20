import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * The super-user console's server side.
 *
 * The acceptance test here is that the usage counters match a direct query of
 * the underlying tables. It is written as a genuine comparison — the assertion
 * counts the rows itself with `ctx.db` rather than restating a number — so it
 * would still catch a future "optimisation" that starts caching the count
 * somewhere. Today it passes by construction, because the counter IS the
 * query; that is the point, and the test is what stops that quietly changing.
 */

const SUPER = { subject: "user_super" };
const OWNER_A = {
  subject: "user_owner_a",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:admin",
};

async function kitchens() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  const asSuper = t.withIdentity(SUPER);
  for (const [orgId, slug, name] of [
    ["org_kitchen_a", "kitchen-a", "Kitchen A"],
    ["org_kitchen_b", "kitchen-b", "Kitchen B"],
  ] as const) {
    await asSuper.mutation(api.admin.provisionOrg, { orgId, slug, name });
  }
  return t;
}

const asSuper = (t: ReturnType<typeof convexTest>) => t.withIdentity(SUPER);

/**
 * An order row written straight to the table.
 *
 * Deliberately not through `orders.create`: this test is about counting what
 * is in the table, so putting rows there directly keeps the arrangement
 * honest and lets a cancelled order exist without a cancellation flow.
 */
async function order(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  orderDate: string,
  over: { status?: "confirmed" | "cancelled"; deliveryDate?: string } = {},
) {
  seq += 1;
  const unique = `${orgId}_${orderDate}_${seq}`;
  return await t.run(async (ctx) =>
    ctx.db.insert("orders", {
      orgId,
      orderDate,
      deliveryDate: over.deliveryDate ?? orderDate,
      status: over.status ?? "confirmed",
      source: "app" as const,
      discountCents: 0,
      deliveryFeeCents: 0,
      deliveryCostCents: 0,
      taxRateBpAtCreation: 0,
      taxInclusiveAtCreation: false,
      revision: 0,
      feedbackToken: `f_${unique}`,
      invoiceToken: `i_${unique}`,
    }),
  );
}

/** Tokens are unique by index; a counter beats a random so a failure is
 * reproducible. */
let seq = 0;

beforeEach(() => {
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("usage counters", () => {
  test("ACCEPTANCE: the count matches a direct query of the table", async () => {
    const t = await kitchens();
    // August for A, and one straddling order in July that must not count.
    await order(t, "org_kitchen_a", "2026-08-01");
    await order(t, "org_kitchen_a", "2026-08-31");
    await order(t, "org_kitchen_a", "2026-07-31");
    await order(t, "org_kitchen_b", "2026-08-15");

    const { counts } = await asSuper(t).query(api.admin.usage, {
      month: "2026-08",
    });

    // The comparison, counted independently rather than restated.
    const direct = await t.run(async (ctx) => {
      const rows = await ctx.db.query("orders").collect();
      const tally: Record<string, number> = {};
      for (const row of rows) {
        if (!row.orderDate.startsWith("2026-08")) continue;
        tally[row.orgId] = (tally[row.orgId] ?? 0) + 1;
      }
      return tally;
    });

    expect(counts.org_kitchen_a).toBe(direct.org_kitchen_a);
    expect(counts.org_kitchen_b).toBe(direct.org_kitchen_b);
    expect(counts.org_kitchen_a).toBe(2);
    expect(counts.org_kitchen_b).toBe(1);
  });

  test("a cancelled order still counts — she used Sous to take it", async () => {
    const t = await kitchens();
    await order(t, "org_kitchen_a", "2026-08-04");
    await order(t, "org_kitchen_a", "2026-08-05", { status: "cancelled" });

    const { counts } = await asSuper(t).query(api.admin.usage, {
      month: "2026-08",
    });
    // The dashboard rightly excludes cancellations from revenue. Usage is a
    // different question, and this is the line where the two part company.
    expect(counts.org_kitchen_a).toBe(2);
  });

  test("counted by orderDate, not deliveryDate", async () => {
    const t = await kitchens();
    // Taken in August for a wedding in October. August's use of Sous.
    await order(t, "org_kitchen_a", "2026-08-04", {
      deliveryDate: "2026-10-10",
    });

    expect(
      (await asSuper(t).query(api.admin.usage, { month: "2026-08" })).counts
        .org_kitchen_a,
    ).toBe(1);
    expect(
      (await asSuper(t).query(api.admin.usage, { month: "2026-10" })).counts
        .org_kitchen_a,
    ).toBe(0);
  });

  test("February is not 31 days, and the string bound does not care", async () => {
    const t = await kitchens();
    await order(t, "org_kitchen_a", "2026-02-28");
    await order(t, "org_kitchen_a", "2026-03-01");

    const { counts } = await asSuper(t).query(api.admin.usage, {
      month: "2026-02",
    });
    expect(counts.org_kitchen_a).toBe(1);
  });

  test("a kitchen with no orders reports zero, not a missing key", async () => {
    const t = await kitchens();
    const { counts } = await asSuper(t).query(api.admin.usage, {
      month: "2026-08",
    });
    expect(counts.org_kitchen_a).toBe(0);
    expect(counts.org_kitchen_b).toBe(0);
  });

  test("a malformed month is refused rather than silently counting nothing", async () => {
    const t = await kitchens();
    await expect(
      asSuper(t).query(api.admin.usage, { month: "August" }),
    ).rejects.toThrow();
  });
});

describe("tiers", () => {
  test("setPlan moves a kitchen and setFoundingMember is independent of it", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.setPlan, {
      orgId: "org_kitchen_a",
      plan: "standard",
    });
    await asSuper(t).mutation(api.admin.setFoundingMember, {
      orgId: "org_kitchen_a",
      foundingMember: true,
    });

    const [org] = (await asSuper(t).query(api.admin.listOrgs, {})).filter(
      (o) => o.orgId === "org_kitchen_a",
    );
    expect(org.plan).toBe("standard");
    expect(org.foundingMember).toBe(true);
  });

  test("the tier never reaches the org itself", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.setPlan, {
      orgId: "org_kitchen_a",
      plan: "unlimited",
    });
    const org = await t
      .withIdentity(OWNER_A)
      .query(api.orgs.getCurrent, { orgSlug: "kitchen-a" });
    expect(org).not.toHaveProperty("plan");
    expect(org).not.toHaveProperty("foundingMember");
  });

  test("an unknown kitchen is refused", async () => {
    const t = await kitchens();
    await expect(
      asSuper(t).mutation(api.admin.setPlan, {
        orgId: "org_nope",
        plan: "free",
      }),
    ).rejects.toThrow("No such kitchen.");
  });
});

describe("access", () => {
  test("a non-super-user gets NOT_FOUND from every admin function", async () => {
    const t = await kitchens();
    const asOwner = t.withIdentity(OWNER_A);

    // NOT_FOUND, never FORBIDDEN: /admin must not confirm it exists to
    // somebody who should not know (CONTEXT.md — Access).
    await expect(
      asOwner.query(api.admin.usage, { month: "2026-08" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      asOwner.mutation(api.admin.setPlan, {
        orgId: "org_kitchen_a",
        plan: "standard",
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      asOwner.mutation(api.admin.setFoundingMember, {
        orgId: "org_kitchen_a",
        foundingMember: true,
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      asOwner.query(api.admin.currentImpersonation, {}),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      asOwner.query(api.admin.impersonationHistory, {
        orgId: "org_kitchen_a",
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  test("provisioning the same kitchen twice throws", async () => {
    const t = await kitchens();
    await expect(
      asSuper(t).mutation(api.admin.provisionOrg, {
        orgId: "org_kitchen_a",
        slug: "kitchen-a",
        name: "Kitchen A",
      }),
    ).rejects.toThrow("already provisioned");
  });
});

describe("disabling", () => {
  test("setDisabled flips it and back", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.setDisabled, {
      orgId: "org_kitchen_a",
      disabled: true,
    });
    const disabled = await t
      .withIdentity(OWNER_A)
      .query(api.orgs.getCurrent, { orgSlug: "kitchen-a" });
    expect(disabled.disabled).toBe(true);

    await asSuper(t).mutation(api.admin.setDisabled, {
      orgId: "org_kitchen_a",
      disabled: false,
    });
    const enabled = await t
      .withIdentity(OWNER_A)
      .query(api.orgs.getCurrent, { orgSlug: "kitchen-a" });
    expect(enabled.disabled).toBe(false);
  });
});
