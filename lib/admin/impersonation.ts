import "server-only";
import { auth } from "@clerk/nextjs/server";
import { cache } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { isSuperUser } from "@/lib/auth/super-user";

export interface ImpersonationView {
  orgId: string;
  orgSlug: string;
  orgName: string;
  expiresAt: number;
}

/**
 * The session this request's caller holds, read on the SERVER.
 *
 * The org shell needs this because `resolveOrgAccess` — the render-time guard
 * — asks Clerk for memberships, and a super user is not a member of the
 * kitchen they are viewing. Without this the layout would `notFound()` before
 * Convex was ever consulted, and the Convex fallback would never get a chance
 * to matter. Two guards, both taught, or the page is a 404.
 *
 * `cache()` for the same reason `resolveOrgAccess` uses it: the layout and the
 * page both ask, and it is one request.
 *
 * Cheap for everybody else: a non-super-user never makes the call at all.
 */
export const currentImpersonation = cache(
  async (): Promise<ImpersonationView | null> => {
    const { userId, getToken } = await auth();
    if (!isSuperUser(userId)) return null;

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) return null;

    const jwt =
      (await getToken({ template: "convex" }).catch(() => null)) ??
      (await getToken());
    if (!jwt) return null;

    try {
      const convex = new ConvexHttpClient(convexUrl);
      convex.setAuth(jwt);
      return await convex.query(api.admin.currentImpersonation, {});
    } catch {
      // A failure here must never take the shell down. The worst outcome is
      // no banner on a page the Convex layer will refuse to write to anyway.
      return null;
    }
  },
);
