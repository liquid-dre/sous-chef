import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "../_generated/server";
import { ConvexError, v, type ObjectType, type PropertyValidators } from "convex/values";
import type { DefaultFunctionArgs } from "convex/server";
import type { Doc } from "../_generated/dataModel";

/**
 * THE tenancy boundary. Every Convex function in this codebase is created by
 * one of the builders below — never by importing query/mutation from
 * _generated/server directly. An ESLint rule and convex/enforcement.test.ts
 * fail the build otherwise. Ad hoc orgId checks inside individual functions
 * are forbidden: this is the one place tenancy is enforced, and therefore the
 * one place it can be reviewed. (CONTEXT.md — Access.)
 *
 * Identity comes from the Clerk JWT (session token with aud "convex", or a
 * "convex" JWT template — SETUP.md step 2): org_id, org_slug, org_role.
 * orgId on every document is the Clerk organization ID string.
 * Clerk org:admin → owner; anything else → staff. Exactly two roles.
 */

export type Role = "owner" | "staff";

/** Re-exported so feature files can type helpers without touching
 * _generated/server directly (the enforcement test forbids it). */
export type { QueryCtx, MutationCtx };

export interface OrgCtx {
  /** Clerk organization ID — stamp this on every document you write. */
  orgId: string;
  role: Role;
  /**
   * Clerk user ID of whoever is calling. For attribution on documents that
   * record who did something — who took this $40, who resolved this alert.
   * In a two-person kitchen that is the first question asked when the cash
   * and the books disagree, and it is unanswerable after the fact if it was
   * never written down.
   */
  userId: string;
  /** Sous settings row for the org; null until the super user provisions it. */
  org: Doc<"orgs"> | null;
  /**
   * True when a super user is looking at a kitchen they are not a member of.
   *
   * Read-only, always. Every write in Sous funnels through the two
   * `assertWritable` calls below, and this flag is refused there — so the
   * guarantee is one check at a chokepoint rather than 53 checks that each
   * have to be remembered. A handler should never need to read this to decide
   * whether it may write; if one does, the boundary has been bypassed.
   */
  impersonating: boolean;
}

/** Thrown as NOT_FOUND on any tenancy failure: a wrong org must look
 * indistinguishable from a nonexistent one. */
const NOT_FOUND = () => new ConvexError({ code: "NOT_FOUND" as const });

/**
 * How long a super user may hold a kitchen open. Thirty minutes.
 *
 * The "Stop impersonating" button carries her intent; this covers everything
 * that is not intent. A closed laptop, a killed tab and a crashed browser all
 * write nothing, and without a cap the next visit to that slug would silently
 * resume full read access to somebody else's books. Enforced here rather than
 * by a client timer, because a client timer is a suggestion.
 */
export const MAX_IMPERSONATION_MS = 30 * 60 * 1000;

function orgByOrgId(ctx: QueryCtx | MutationCtx, orgId: string) {
  return ctx.db
    .query("orgs")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
}

/**
 * The one other way into a kitchen, and the only one.
 *
 * Returns the open session this caller holds on `orgSlug`, or null. Null is
 * indistinguishable from every other tenancy failure by design — the caller
 * turns it into the same NOT_FOUND a stranger gets.
 *
 * The allowlist is re-checked on every call rather than trusted from the row.
 * A session is a record that access was opened, not a grant that outlives the
 * authority which opened it: dropping an id from SOUS_SUPER_USER_IDS has to
 * close every door that id is holding, immediately, without anyone having to
 * find and end the rows by hand.
 */
async function openImpersonation(
  ctx: QueryCtx | MutationCtx,
  subject: string,
  orgSlug: string,
) {
  if (!isSuperUser(subject)) return null;
  const session = await ctx.db
    .query("impersonationSessions")
    .withIndex("by_super_open", (q) =>
      q.eq("superUserId", subject).eq("endedAt", undefined),
    )
    .unique();
  if (!session) return null;
  if (session.orgSlug !== orgSlug) return null;
  if (Date.now() - session.startedAt > MAX_IMPERSONATION_MS) return null;
  return session;
}

async function resolveOrg(
  ctx: QueryCtx | MutationCtx,
  orgSlug: string,
): Promise<OrgCtx> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" as const });
  const claims = identity as unknown as Record<string, unknown>;
  const orgId = claims.org_id;
  const jwtSlug = claims.org_slug;
  const rawRole = claims.org_role;
  if (typeof jwtSlug !== "string" || jwtSlug !== orgSlug) {
    // Not a member of this kitchen. A super user with an open session may
    // still READ it; everyone else, including a super user without one, gets
    // the same NOT_FOUND as somebody guessing at slugs.
    const session = await openImpersonation(ctx, identity.subject, orgSlug);
    if (!session) throw NOT_FOUND();
    return {
      orgId: session.orgId,
      // Owner, because the point is seeing what SHE sees and the costs and
      // margins are the whole reason to look. It grants no write reach:
      // assertWritable refuses on the flag before it reads the role.
      role: "owner",
      userId: identity.subject,
      org: await orgByOrgId(ctx, session.orgId),
      impersonating: true,
    };
  }
  if (typeof orgId !== "string" || orgId === "") throw NOT_FOUND();
  const role: Role =
    typeof rawRole === "string" && rawRole.endsWith("admin") ? "owner" : "staff";
  return {
    orgId,
    role,
    userId: identity.subject,
    org: await orgByOrgId(ctx, orgId),
    impersonating: false,
  };
}

function assertWritable(org: Doc<"orgs"> | null, impersonating: boolean) {
  // First, and before the org is even consulted. Looking at somebody else's
  // kitchen is never a licence to change it, disabled or not.
  if (impersonating) {
    throw new ConvexError({
      code: "IMPERSONATING" as const,
      message: "You're viewing this kitchen. Nothing here can be changed.",
    });
  }
  if (org?.disabled) {
    throw new ConvexError({
      code: "ORG_DISABLED" as const,
      message: "This kitchen is read-only.",
    });
  }
}

/**
 * The disabled check for a function that never resolved an org.
 *
 * `publicQuery`/`publicMutation` are bare aliases of the raw builders — they
 * take no orgSlug and reach no `resolveOrg`, so the two public mutations
 * (feedback.submit, invoices.recordView) sailed straight past `assertWritable`
 * and would write into a disabled kitchen. They reach their org through an
 * unguessable token instead, so this takes the orgId they have already found.
 *
 * A PREDICATE rather than an assertion, unlike everything else in this file.
 * Both callers are unauthenticated pages read by the kitchen's customer, and
 * both already answer failure in their own vocabulary — one returns a reason
 * the form renders, the other returns null and says nothing. Throwing here
 * would surface as "check your signal", which would be a lie, and it would
 * also tell a stranger that this kitchen has been disabled by Sous. That is
 * between the kitchen and Sous.
 *
 * Writes only. A disabled kitchen's invoice stays READABLE for the customer
 * holding the link (convex/invoices.ts) — a stranger should not find a dead
 * page because of somebody else's billing.
 */
export async function orgIsWritable(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<boolean> {
  const org = await orgByOrgId(ctx, orgId);
  return !org?.disabled;
}

function assertOwner(role: Role) {
  if (role !== "owner") throw new ConvexError({ code: "FORBIDDEN" as const });
}

interface OrgFunctionDef<
  Ctx,
  Args extends PropertyValidators,
  Output,
> {
  args: Args;
  handler: (ctx: Ctx & OrgCtx, args: ObjectType<Args>) => Promise<Output>;
}

/** Org-scoped read. Any member. */
export function orgQuery<Args extends PropertyValidators, Output>(
  def: OrgFunctionDef<QueryCtx, Args, Output>,
) {
  return query({
    args: { ...def.args, orgSlug: v.string() },
    handler: async (ctx, allArgs) => {
      const { orgSlug, ...args } = allArgs;
      const orgCtx = await resolveOrg(ctx, orgSlug as string);
      return def.handler(
        Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, orgCtx),
        args as ObjectType<Args>,
      );
    },
  });
}

/** Org-scoped write. Any member. Disabled orgs are read-only. */
export function orgMutation<Args extends PropertyValidators, Output>(
  def: OrgFunctionDef<MutationCtx, Args, Output>,
) {
  return mutation({
    args: { ...def.args, orgSlug: v.string() },
    handler: async (ctx, allArgs) => {
      const { orgSlug, ...args } = allArgs;
      const orgCtx = await resolveOrg(ctx, orgSlug as string);
      assertWritable(orgCtx.org, orgCtx.impersonating);
      return def.handler(
        Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, orgCtx),
        args as ObjectType<Args>,
      );
    },
  });
}

/** Owner-only read: costs, margins, the dashboard. Staff are rejected here,
 * at the server — never by hiding things client-side. */
export function ownerQuery<Args extends PropertyValidators, Output>(
  def: OrgFunctionDef<QueryCtx, Args, Output>,
) {
  return query({
    args: { ...def.args, orgSlug: v.string() },
    handler: async (ctx, allArgs) => {
      const { orgSlug, ...args } = allArgs;
      const orgCtx = await resolveOrg(ctx, orgSlug as string);
      assertOwner(orgCtx.role);
      return def.handler(
        Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, orgCtx),
        args as ObjectType<Args>,
      );
    },
  });
}

/** Owner-only write. */
export function ownerMutation<Args extends PropertyValidators, Output>(
  def: OrgFunctionDef<MutationCtx, Args, Output>,
) {
  return mutation({
    args: { ...def.args, orgSlug: v.string() },
    handler: async (ctx, allArgs) => {
      const { orgSlug, ...args } = allArgs;
      const orgCtx = await resolveOrg(ctx, orgSlug as string);
      assertOwner(orgCtx.role);
      assertWritable(orgCtx.org, orgCtx.impersonating);
      return def.handler(
        Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, orgCtx),
        args as ObjectType<Args>,
      );
    },
  });
}

// --- Super user -----------------------------------------------------------

/** Same allowlist the proxy reads; Convex gets its copy of the env var via
 * the dashboard (SETUP.md). */
function isSuperUser(subject: string): boolean {
  return (process.env.SOUS_SUPER_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(subject);
}

async function requireSuperUser(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !isSuperUser(identity.subject)) throw NOT_FOUND();
  return identity.subject;
}

interface SuperFunctionDef<Ctx, Args extends PropertyValidators, Output> {
  args: Args;
  handler: (
    ctx: Ctx & { superUserId: string },
    args: ObjectType<Args>,
  ) => Promise<Output>;
}

export function superQuery<Args extends PropertyValidators, Output>(
  def: SuperFunctionDef<QueryCtx, Args, Output>,
) {
  return query({
    args: { ...def.args },
    handler: async (ctx, args?: DefaultFunctionArgs) => {
      const superUserId = await requireSuperUser(ctx);
      return def.handler(
        Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, {
          superUserId,
        }),
        (args ?? {}) as ObjectType<Args>,
      );
    },
  });
}

export function superMutation<Args extends PropertyValidators, Output>(
  def: SuperFunctionDef<MutationCtx, Args, Output>,
) {
  return mutation({
    args: { ...def.args },
    handler: async (ctx, args?: DefaultFunctionArgs) => {
      const superUserId = await requireSuperUser(ctx);
      return def.handler(
        Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, {
          superUserId,
        }),
        (args ?? {}) as ObjectType<Args>,
      );
    },
  });
}

// --- Public ---------------------------------------------------------------

/** For /f/[token] and /i/[token] functions only: unauthenticated by design,
 * scoped by an unguessable token instead of a session. Exported here so even
 * public functions route through this file. */
export const publicQuery = query;
export const publicMutation = mutation;
