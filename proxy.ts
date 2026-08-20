import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isSuperUser } from "@/lib/auth/super-user";

/**
 * Authentication lives here; org tenancy lives in two other places by design:
 * app/[orgSlug]/layout.tsx (membership → 404) and convex/lib/functions.ts
 * (the withOrg boundary). The proxy never confirms that anything exists to
 * someone who shouldn't know: a non-super-user hitting /admin gets the same
 * 404 as a route that was never there.
 */

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/f/(.*)", // public feedback capture, token-scoped
  "/i/(.*)", // shareable invoice, token-scoped
  "/c/(.*)", // shareable campaign, token-scoped
  "/design-system(.*)",
]);

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: req.url });
  if (isAdminRoute(req) && !isSuperUser(userId)) {
    // Rewrite to an unrouted path: renders the 404 page, status 404.
    return NextResponse.rewrite(new URL("/404", req.url));
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
