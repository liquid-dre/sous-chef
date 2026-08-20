import type { ClerkOrg } from "@/lib/admin/clerk-orgs";

/**
 * One row of the console: what Clerk knows joined to what Sous knows.
 *
 * The two halves genuinely can disagree, and the type says so. `provisioned`
 * false is a real, reachable, recoverable state — a Clerk org whose Sous row
 * has not been written — and everything Sous-side is therefore nullable
 * rather than defaulted. Defaulting a missing row to "free, enabled" would
 * render a kitchen that does not exist yet as a working one.
 */
export interface AdminOrgRow extends ClerkOrg {
  provisioned: boolean;
  plan: Plan | null;
  foundingMember: boolean | null;
  disabled: boolean | null;
  /** Orders taken this month. Derived on read (convex/admin.ts usage). */
  ordersThisMonth: number;
}

export type Plan = "free" | "standard" | "unlimited";

/**
 * What each tier is called and what it costs. The money lives here rather
 * than in the schema because it is a label, not a fact the app acts on:
 * nothing is enforced, nothing is charged, and no checkout exists (Stripe
 * does not operate in Zimbabwe).
 */
export const PLAN_LABEL: Record<Plan, string> = {
  free: "Free",
  standard: "$20",
  unlimited: "$50",
};

/** The seats and volume each tier will eventually mean (CONTEXT.md — Access).
 * Shown as intent so the numbers being collected have a visible purpose;
 * nothing reads them to enforce anything. */
export const PLAN_INTENT: Record<Plan, string> = {
  free: "1 user · 30 orders a month",
  standard: "3 users · unlimited orders",
  unlimited: "Unlimited users",
};

export const PLANS: Plan[] = ["free", "standard", "unlimited"];

export interface ImpersonationRow {
  id: string;
  superUserId: string;
  startedAt: number;
  endedAt: number | null;
}
