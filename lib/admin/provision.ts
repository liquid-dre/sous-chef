"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { isSuperUser } from "@/lib/auth/super-user";

/**
 * Provisioning a kitchen: a Clerk organization, an invitation, and a Sous row.
 *
 * It lives in Next because Clerk's admin API needs `CLERK_SECRET_KEY` and
 * Convex cannot make a network call at all — `convex/lib/functions.ts` has
 * eight builders and none of them is an action.
 *
 * CLERK FIRST, ROW SECOND, and the order is the error handling. If the row
 * fails, the kitchen exists in Clerk unprovisioned — which is a state this app
 * already knows how to be in and which the console renders as its own row with
 * a Finish setup button. The reverse order would leave a Sous row naming a
 * Clerk org that does not exist: unreachable by any route, invisible to
 * `resolveOrgAccess`, and un-retryable because `provisionOrg` refuses to run
 * twice for one orgId.
 *
 * A server function is reachable by direct POST, not only through this UI, so
 * the super-user check happens HERE and does not lean on the proxy.
 */

export type ProvisionResult =
  | { ok: true; orgId: string; slug: string; invited: string }
  | { ok: false; message: string; orgId?: string };

export async function provisionKitchen(input: {
  name: string;
  slug: string;
  ownerEmail: string;
  plan: "free" | "standard" | "unlimited";
  foundingMember: boolean;
}): Promise<ProvisionResult> {
  const { userId, getToken } = await auth();
  if (!isSuperUser(userId)) {
    // The same silence /admin gives everyone else. Never "forbidden", which
    // would confirm there is something here to be forbidden from.
    return { ok: false, message: "Not found." };
  }

  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const ownerEmail = input.ownerEmail.trim();
  if (!name) return { ok: false, message: "The kitchen needs a name." };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return {
      ok: false,
      message: "The slug is the URL — lowercase letters, numbers and hyphens.",
    };
  }
  if (!ownerEmail.includes("@")) {
    return { ok: false, message: "That owner email doesn't look right." };
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return { ok: false, message: "Convex isn't connected — see SETUP.md." };
  }

  const client = await clerkClient();

  // 1. The Clerk organization.
  let orgId: string;
  try {
    const org = await client.organizations.createOrganization({
      name,
      slug,
      createdBy: userId!,
    });
    orgId = org.id;
  } catch (error) {
    return { ok: false, message: clerkMessage(error, "create this kitchen") };
  }

  // 2. The invitation. A failure here is NOT fatal: the org exists, and an
  //    invite can be resent from Clerk. Reporting it as a total failure would
  //    invite a retry that then collides on the slug.
  let invited = ownerEmail;
  try {
    await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: ownerEmail,
      // org:admin maps to owner. There is no self-signup in v1, so this
      // invitation is the only way into a new kitchen.
      role: "org:admin",
      inviterUserId: userId!,
    });
  } catch {
    invited = "";
  }

  // 3. The Sous row, through the caller's own JWT so tenancy still ends in
  //    Convex rather than in this handler.
  const jwt =
    (await getToken({ template: "convex" }).catch(() => null)) ??
    (await getToken());
  if (!jwt) {
    return {
      ok: false,
      orgId,
      message: "The kitchen was created but your session expired. Sign in again and finish setup.",
    };
  }

  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(jwt);
  try {
    await convex.mutation(api.admin.provisionOrg, {
      orgId,
      slug,
      name,
      foundingMember: input.foundingMember,
    });
    if (input.plan !== "free") {
      await convex.mutation(api.admin.setPlan, { orgId, plan: input.plan });
    }
  } catch {
    return {
      ok: false,
      orgId,
      message:
        "The kitchen exists in Clerk but its Sous settings didn't save. It's listed below as not provisioned — finish it from there.",
    };
  }

  revalidatePath("/admin");
  return { ok: true, orgId, slug, invited };
}

/**
 * Finish a kitchen that exists in Clerk but has no Sous row.
 *
 * The other half of the half-failure above, and also the path for an org that
 * was created by hand in Clerk's dashboard — which SETUP.md §6.1 describes as
 * the ordinary way the pilot kitchen came to exist.
 */
export async function finishProvisioning(input: {
  orgId: string;
  slug: string;
  name: string;
  foundingMember: boolean;
}): Promise<ProvisionResult> {
  const { userId, getToken } = await auth();
  if (!isSuperUser(userId)) return { ok: false, message: "Not found." };

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return { ok: false, message: "Convex isn't connected — see SETUP.md." };
  }
  const jwt =
    (await getToken({ template: "convex" }).catch(() => null)) ??
    (await getToken());
  if (!jwt) return { ok: false, message: "Sign in again." };

  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(jwt);
  try {
    await convex.mutation(api.admin.provisionOrg, {
      orgId: input.orgId,
      slug: input.slug,
      name: input.name,
      foundingMember: input.foundingMember,
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "That didn't save.",
    };
  }

  revalidatePath("/admin");
  return { ok: true, orgId: input.orgId, slug: input.slug, invited: "" };
}

/** Clerk's own words when it has them — "That slug is taken" is worth
 * repeating verbatim, and a generic failure is not. */
function clerkMessage(error: unknown, doing: string): string {
  const errors = (error as { errors?: { message?: string }[] } | null)?.errors;
  const first = errors?.[0]?.message;
  return first ? first : `Couldn't ${doing}. Nothing was created.`;
}
