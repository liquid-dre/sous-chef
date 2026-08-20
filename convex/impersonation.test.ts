import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Read-only impersonation (CONTEXT.md — Access).
 *
 * The test that carries this slice is the first one: a mutation called
 * DIRECTLY while impersonating is refused. Directly matters — the scope asks
 * for proof at the server, and a UI that hides the button proves nothing about
 * a crafted call. Because every write in Sous funnels through the two
 * `assertWritable` calls in convex/lib/functions.ts, one `orgMutation` and one
 * `ownerMutation` between them cover all 53.
 *
 * The second load-bearing test is "a row alone is not enough": the session
 * grants nothing once the caller leaves the super-user allowlist. A permission
 * that outlives the authority which granted it is a back door, and this table
 * is the only way into a kitchen you are not a member of.
 */

const SUPER = { subject: "user_super" };
const OWNER_A = {
  subject: "user_owner_a",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:admin",
};

const START = new Date("2026-08-06T09:00:00Z").getTime();
/** convex/lib/functions.ts MAX_IMPERSONATION_MS. */
const CAP_MS = 30 * 60 * 1000;

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("opening a session", () => {
  test("a super user can READ a kitchen they are not a member of", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });

    const org = await asSuper(t).query(api.orgs.getCurrent, {
      orgSlug: "kitchen-a",
    });
    expect(org).toMatchObject({ orgId: "org_kitchen_a", role: "owner" });
  });

  test("without a session the same read is NOT_FOUND", async () => {
    const t = await kitchens();
    await expect(
      asSuper(t).query(api.orgs.getCurrent, { orgSlug: "kitchen-a" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  test("a session on A does not open B", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });
    await expect(
      asSuper(t).query(api.orgs.getCurrent, { orgSlug: "kitchen-b" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  test("starting a second session closes the first", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-b",
    });

    // One door at a time.
    await expect(
      asSuper(t).query(api.orgs.getCurrent, { orgSlug: "kitchen-a" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      asSuper(t).query(api.orgs.getCurrent, { orgSlug: "kitchen-b" }),
    ).resolves.toMatchObject({ orgId: "org_kitchen_b" });

    const history = await asSuper(t).query(api.admin.impersonationHistory, {
      orgId: "org_kitchen_a",
    });
    expect(history).toHaveLength(1);
    expect(history[0].endedAt).not.toBeNull();
  });
});

describe("read-only", () => {
  test("ACCEPTANCE: a mutation called directly while impersonating is refused", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });

    // An ownerMutation. Both chokepoints are covered between this and the
    // orgMutation below, and every write in Sous passes through one of them.
    await expect(
      asSuper(t).mutation(api.orgs.setCostDriftThreshold, {
        orgSlug: "kitchen-a",
        costDriftThresholdPercent: 15,
      }),
    ).rejects.toMatchObject({ data: { code: "IMPERSONATING" } });

    // An orgMutation — the builder staff writes go through.
    await expect(
      asSuper(t).mutation(api.orders.create, {
        orgSlug: "kitchen-a",
        phone: "+263715550184",
        name: "Andre",
        orderDate: "2026-08-06",
        deliveryDate: "2026-08-08",
        lines: [
          {
            description: "A cake",
            qtyMilli: 1000,
            unitPriceCents: 2000,
            roughCostCents: 800,
          },
        ],
      }),
    ).rejects.toMatchObject({ data: { code: "IMPERSONATING" } });
  });

  test("the refusal outranks the disabled check, and nothing was written", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });
    await expect(
      asSuper(t).mutation(api.orgs.setCostDriftThreshold, {
        orgSlug: "kitchen-a",
        costDriftThresholdPercent: 15,
      }),
    ).rejects.toMatchObject({ data: { code: "IMPERSONATING" } });

    // provisionOrg seeds 10. If the mutation had run, this would be 15.
    const org = await t.run(async (ctx) =>
      ctx.db
        .query("orgs")
        .withIndex("by_orgId", (q) => q.eq("orgId", "org_kitchen_a"))
        .unique(),
    );
    expect(org?.costDriftThresholdPercent).toBe(10);
  });

  test("the real owner is unaffected by somebody else's session", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });
    await expect(
      t.withIdentity(OWNER_A).mutation(api.orgs.setCostDriftThreshold, {
        orgSlug: "kitchen-a",
        costDriftThresholdPercent: 15,
      }),
    ).resolves.toBeNull();
  });
});

describe("closing", () => {
  test("stopping ends the read access", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });
    await asSuper(t).mutation(api.admin.stopImpersonation, {});

    await expect(
      asSuper(t).query(api.orgs.getCurrent, { orgSlug: "kitchen-a" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  test("stopping twice is not an error", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });
    await asSuper(t).mutation(api.admin.stopImpersonation, {});
    await expect(
      asSuper(t).mutation(api.admin.stopImpersonation, {}),
    ).resolves.toBeNull();
  });

  test("a session past the 30-minute cap resolves to nothing", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });

    // One second inside the cap: still open.
    vi.setSystemTime(START + CAP_MS - 1000);
    await expect(
      asSuper(t).query(api.orgs.getCurrent, { orgSlug: "kitchen-a" }),
    ).resolves.toMatchObject({ orgId: "org_kitchen_a" });

    // One second past it: the laptop lid closed and the door shut itself.
    vi.setSystemTime(START + CAP_MS + 1000);
    await expect(
      asSuper(t).query(api.orgs.getCurrent, { orgSlug: "kitchen-a" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });

    // And the banner agrees with the boundary, rather than claiming a session
    // the server has already stopped honouring.
    expect(
      await asSuper(t).query(api.admin.currentImpersonation, {}),
    ).toBeNull();
  });

  test("a lapsed session keeps endedAt unset — nobody closed it", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });
    vi.setSystemTime(START + CAP_MS + 1000);

    const history = await asSuper(t).query(api.admin.impersonationHistory, {
      orgId: "org_kitchen_a",
    });
    expect(history[0].endedAt).toBeNull();
  });
});

describe("the row is not the authority", () => {
  test("ACCEPTANCE-adjacent: dropping the allowlist closes an open session", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });
    // It works while they are a super user…
    await expect(
      asSuper(t).query(api.orgs.getCurrent, { orgSlug: "kitchen-a" }),
    ).resolves.toMatchObject({ orgId: "org_kitchen_a" });

    // …and stops the moment they are not, with the row still open and
    // unexpired. Revoking access must not require finding and ending rows.
    vi.stubEnv("SOUS_SUPER_USER_IDS", "");
    await expect(
      asSuper(t).query(api.orgs.getCurrent, { orgSlug: "kitchen-a" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  test("a non-super-user cannot open a session at all", async () => {
    const t = await kitchens();
    await expect(
      t
        .withIdentity(OWNER_A)
        .mutation(api.admin.startImpersonation, { orgSlug: "kitchen-b" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});

describe("what the banner reads", () => {
  test("currentImpersonation names the kitchen and when it expires", async () => {
    const t = await kitchens();
    await asSuper(t).mutation(api.admin.startImpersonation, {
      orgSlug: "kitchen-a",
    });
    const current = await asSuper(t).query(api.admin.currentImpersonation, {});
    expect(current).toMatchObject({
      orgId: "org_kitchen_a",
      orgSlug: "kitchen-a",
      orgName: "Kitchen A",
      startedAt: START,
      expiresAt: START + CAP_MS,
    });
  });

  test("it is null when nothing is open", async () => {
    const t = await kitchens();
    expect(
      await asSuper(t).query(api.admin.currentImpersonation, {}),
    ).toBeNull();
  });
});
