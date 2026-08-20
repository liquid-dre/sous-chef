import "server-only";
import { cache } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";

export type Role = "owner" | "staff";

export interface OrgAccess {
  orgId: string;
  slug: string;
  name: string;
  role: Role;
}

/**
 * Resolves the signed-in user's membership of the org in the route. Returns
 * null for non-members — callers turn that into notFound(), never into a
 * "you lack permission" page that confirms the org exists.
 *
 * cache() dedupes the Clerk API call across the layout and every page in the
 * same request. This is the render-time guard; the data-layer guard is
 * convex/lib/functions.ts, which trusts only the JWT.
 */
export const resolveOrgAccess = cache(
  async (orgSlug: string): Promise<OrgAccess | null> => {
    const { userId } = await auth();
    if (!userId) return null;
    const client = await clerkClient();
    const memberships = await client.users.getOrganizationMembershipList({
      userId,
      limit: 100,
    });
    const membership = memberships.data.find(
      (m) => m.organization.slug === orgSlug,
    );
    if (!membership) return null;
    return {
      orgId: membership.organization.id,
      slug: orgSlug,
      name: membership.organization.name,
      role: membership.role.endsWith("admin") ? "owner" : "staff",
    };
  },
);

/** First org for the signed-in user, for the root redirect. */
export const firstOrgSlug = cache(async (): Promise<string | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const client = await clerkClient();
  const memberships = await client.users.getOrganizationMembershipList({
    userId,
    limit: 1,
  });
  return memberships.data[0]?.organization.slug ?? null;
});
