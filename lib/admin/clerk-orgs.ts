import "server-only";
import { clerkClient } from "@clerk/nextjs/server";

/**
 * The kitchens Clerk knows about.
 *
 * Clerk is the spine of the org list, not Convex, and that is deliberate: a
 * kitchen exists the moment its Clerk organization does, and its Sous row may
 * legitimately arrive seconds or days later. SETUP.md §6 describes exactly
 * that gap as the normal path, `ctx.org` is nullable throughout the Convex
 * layer, and `OnboardingGate` already gates on `provisioned === true`.
 *
 * Listing Convex-first would render that state invisible — a half-finished
 * provision would simply not appear, which is the one moment somebody needs
 * to see it.
 *
 * One call, not one per org: `membersCount` and `createdAt` come back with
 * the list, so the console's "users" and "created" columns cost nothing
 * extra. The owner's address does NOT, which is why it is recorded at
 * provision time instead of being looked up here.
 */
export interface ClerkOrg {
  orgId: string;
  name: string;
  slug: string;
  createdAt: number;
  membersCount: number;
}

export async function listClerkOrgs(): Promise<ClerkOrg[]> {
  const client = await clerkClient();
  // 100 is Clerk's page ceiling and roughly 99 more kitchens than the pilot
  // has. When it stops being enough the console needs paging, and silently
  // truncating would be the wrong way to find that out — so it is stated
  // here rather than discovered when a kitchen goes missing.
  const { data } = await client.organizations.getOrganizationList({
    limit: 100,
    orderBy: "-created_at",
  });
  return data.map((org) => ({
    orgId: org.id,
    name: org.name,
    slug: org.slug ?? "",
    createdAt: org.createdAt,
    membersCount: org.membersCount ?? 0,
  }));
}
