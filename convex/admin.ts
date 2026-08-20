import { v } from "convex/values";
import {
  superQuery,
  superMutation,
  MAX_IMPERSONATION_MS,
  type MutationCtx,
} from "./lib/functions";

/**
 * Super-user provisioning (/admin). The Clerk organization is created first
 * in the Clerk dashboard; this records the Sous settings row for it.
 * Disabled orgs go read-only — never deleted (CONTEXT.md — Access).
 */

export const listOrgs = superQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("orgs").collect();
  },
});

export const provisionOrg = superMutation({
  args: {
    orgId: v.string(),
    slug: v.string(),
    name: v.string(),
    foundingMember: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, slug, name, foundingMember }) => {
    const existing = await ctx.db
      .query("orgs")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (existing) throw new Error("This kitchen is already provisioned.");
    // Defaults per CONTEXT.md: USD only, tax off, drift 10%, tiers invisible
    // and unenforced. Everything else stays unset until she sets it.
    return await ctx.db.insert("orgs", {
      orgId,
      slug,
      name,
      palette: { primary: "#2E6158" },
      currency: "USD" as const,
      invoicePrefix: "INV",
      invoiceSequence: 0,
      taxEnabled: false,
      taxRateBp: 0,
      taxInclusive: false,
      taxLocked: false,
      overheadRateCentsPerHour: 0,
      defaultDepositPercent: 0,
      deliveryFeeModel: "flat" as const,
      deliveryFeeConfig: {},
      deliveryCostCentsPerKm: 0,
      socials: [],
      costDriftThresholdPercent: 10,
      zwgDisplayEnabled: false,
      plan: "free" as const,
      subscriptionStatus: "none" as const,
      foundingMember: foundingMember ?? false,
      disabled: false,
      alertsMuted: false,
    });
  },
});

/**
 * One-off: strip the stored stock level off every ingredient.
 *
 * The pantry level stopped being a field and became a sum of stockMovements
 * (convex/lib/stock.ts). Convex validates whole documents, so a row still
 * carrying `currentStockQtyMilli` fails against the new schema — and it fails
 * at PUSH time, which makes the order matter:
 *
 *   1. Keep `currentStockQtyMilli: v.optional(v.number())` on the ingredients
 *      table, push, so this function exists on a deployment that accepts the
 *      old rows.
 *   2. Run this once per deployment.
 *   3. Delete the field from the schema and push again.
 *
 * A deployment with no ingredient rows yet — a fresh dev database — skips
 * straight to step 3. Returns how many it touched so the answer is a number
 * and not a shrug.
 */
export const stripStoredStockLevels = superMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("ingredients").collect();
    let stripped = 0;
    for (const row of rows) {
      if (!("currentStockQtyMilli" in row)) continue;
      // `undefined` is how Convex removes a field. The cast is because the
      // schema no longer knows the name — which is the entire point.
      await ctx.db.patch(row._id, {
        currentStockQtyMilli: undefined,
      } as unknown as Record<string, never>);
      stripped += 1;
    }
    return { scanned: rows.length, stripped };
  },
});

export const setDisabled = superMutation({
  args: { orgId: v.string(), disabled: v.boolean() },
  handler: async (ctx, { orgId, disabled }) => {
    await ctx.db.patch(await requireOrg(ctx, orgId), { disabled });
    return null;
  },
});

/** The `orgs` row's own id, or a plain refusal. Every super-user mutation
 * below takes an `orgId` string rather than a document id, because that is
 * what Clerk hands the console. */
async function requireOrg(ctx: MutationCtx, orgId: string) {
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
  if (!org) throw new Error("No such kitchen.");
  return org._id;
}

/**
 * Move a kitchen between tiers by hand.
 *
 * The field is `plan` and the UI calls it a tier; both are true. Nothing is
 * enforced and nothing is visible to the org (CONTEXT.md — Access: "Tiers
 * exist in v1 but are invisible to orgs and enforce nothing"). There is no
 * checkout because Stripe does not operate in Zimbabwe, and building a
 * payment flow against a provider that cannot take the money means building
 * it twice.
 */
export const setPlan = superMutation({
  args: {
    orgId: v.string(),
    plan: v.union(
      v.literal("free"),
      v.literal("standard"),
      v.literal("unlimited"),
    ),
  },
  handler: async (ctx, { orgId, plan }) => {
    await ctx.db.patch(await requireOrg(ctx, orgId), { plan });
    return null;
  },
});

/** Grandfathers the pilot to free forever. Separate from `plan` on purpose:
 * a founding member may sit on any tier, and the promise outlives whatever
 * the tier happens to be called next year. */
export const setFoundingMember = superMutation({
  args: { orgId: v.string(), foundingMember: v.boolean() },
  handler: async (ctx, { orgId, foundingMember }) => {
    await ctx.db.patch(await requireOrg(ctx, orgId), { foundingMember });
    return null;
  },
});

// --- Usage ----------------------------------------------------------------

/**
 * Orders per kitchen for one month. DERIVED, never stored.
 *
 * Counters run from day one even though no limit is enforced, because you
 * need six months of real usage before you can set a limit that is not a
 * guess (CONTEXT.md — Access). A stored counter would be a read-modify-write
 * that loses increments under concurrent orders, needs a month-rollover job
 * that no cron exists to run, and drifts from the table it claims to
 * summarise. Counting on read cannot do any of those things — the counter IS
 * the query, which is why the acceptance test comparing it to a direct table
 * read passes by construction rather than by luck.
 *
 * By `orderDate`, NOT `deliveryDate`. The dashboard counts delivery because
 * revenue recognises on delivery; usage is a different question. A January
 * order for a March wedding is January's use of Sous, and she used it in
 * January whether or not the cake was ever delivered — so cancelled orders
 * count here while the dashboard rightly excludes them.
 *
 * `month` is "YYYY-MM" and comes from the client: the server has no "today"
 * (lib/day.ts).
 */
export const usage = superQuery({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error("Months look like 2026-08.");
    }
    // "-31" as a STRING bound, not a date. ISO days compare correctly as
    // plain strings, so this covers 28, 29, 30 and 31-day months alike
    // without anyone having to know which February this is.
    const start = `${month}-01`;
    const end = `${month}-31`;

    const orgs = await ctx.db.query("orgs").collect();
    const counts: Record<string, number> = {};
    for (const org of orgs) {
      const orders = await ctx.db
        .query("orders")
        .withIndex("by_org_orderDate", (q) =>
          q.eq("orgId", org.orgId).gte("orderDate", start).lte("orderDate", end),
        )
        .collect();
      counts[org.orgId] = orders.length;
    }
    return { month, counts };
  },
});

// --- Impersonation --------------------------------------------------------

/**
 * Open a read-only window onto somebody else's kitchen.
 *
 * The row IS the permission and the log at once — convex/lib/functions.ts
 * consults it on every call, and /admin reads it back as the history. There
 * is no separate audit write to forget or to let drift.
 *
 * One door at a time: starting a session closes any other this super user
 * holds open. Two open rows would make `by_super_open`'s `.unique()` throw,
 * and more to the point "which kitchen am I in" should never have two
 * answers.
 */
export const startImpersonation = superMutation({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
      .unique();
    if (!org) throw new Error("No such kitchen.");

    await closeOpenSessions(ctx, ctx.superUserId);

    return await ctx.db.insert("impersonationSessions", {
      orgId: org.orgId,
      orgSlug: org.slug,
      superUserId: ctx.superUserId,
      startedAt: Date.now(),
    });
  },
});

/** Stamp the open session closed. Idempotent — she may tap it twice, or tap
 * it after the 30-minute cap has already made the session useless. */
export const stopImpersonation = superMutation({
  args: {},
  handler: async (ctx) => {
    await closeOpenSessions(ctx, ctx.superUserId);
    return null;
  },
});

async function closeOpenSessions(ctx: MutationCtx, superUserId: string) {
  const open = await ctx.db
    .query("impersonationSessions")
    .withIndex("by_super_open", (q) =>
      q.eq("superUserId", superUserId).eq("endedAt", undefined),
    )
    .collect();
  for (const session of open) {
    await ctx.db.patch(session._id, { endedAt: Date.now() });
  }
}

/**
 * The session this super user currently holds, if it is still live.
 *
 * The org shell reads this to decide whether to render the banner, and it
 * must agree with what the mutation boundary believes — so the same
 * 30-minute cap is applied here. A banner that says "viewing" over a session
 * the server has already stopped honouring would be worse than no banner.
 */
export const currentImpersonation = superQuery({
  args: {},
  handler: async (ctx) => {
    const session = await ctx.db
      .query("impersonationSessions")
      .withIndex("by_super_open", (q) =>
        q.eq("superUserId", ctx.superUserId).eq("endedAt", undefined),
      )
      .unique();
    if (!session) return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_orgId", (q) => q.eq("orgId", session.orgId))
      .unique();
    const expiresAt = session.startedAt + MAX_IMPERSONATION_MS;
    if (Date.now() >= expiresAt) return null;
    return {
      orgId: session.orgId,
      orgSlug: session.orgSlug,
      orgName: org?.name ?? session.orgSlug,
      startedAt: session.startedAt,
      expiresAt,
    };
  },
});

/** Every time anyone looked at this kitchen. The scope asks for session start
 * and end logged with the target org; this is that, read back. */
export const impersonationHistory = superQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query("impersonationSessions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(20);
    return rows.map((row) => ({
      id: row._id,
      superUserId: row.superUserId,
      startedAt: row.startedAt,
      /** Null means nobody pressed stop — it lapsed against the cap. Worth
       * being able to see rather than smoothing into a fake end time. */
      endedAt: row.endedAt ?? null,
    }));
  },
});
