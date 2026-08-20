import { redirect } from "next/navigation";
import { requireOrgPage } from "./_lib/stub-page";
import { HomeContainer } from "@/components/dashboard/home-container";
import { RememberTimezone } from "@/components/dashboard/remember-timezone";
import { serverClaim } from "@/lib/dashboard-fetch";

/**
 * Owner lands on Home; staff land on Calendar (CONTEXT.md — Routes).
 *
 * The redirect is belt to the server-side braces: every figure on this screen
 * is a cost or a margin, and convex/dashboard.ts refuses a staff caller
 * outright — so a staff member who reached this URL would be turned away by
 * the data layer even if this line were ever deleted.
 *
 * The claim is fetched HERE, on the server, so the one sentence she opened
 * Sous to read is in the HTML rather than behind 531KB of JavaScript. It
 * returns null on the very first visit — before the browser has told us her
 * timezone, the server does not know what day it is for her and declines to
 * guess (CONTEXT.md: the server has no "today"). That visit renders on the
 * client exactly as it did before.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params);
  if (access.role === "staff") redirect(`/${access.slug}/calendar`);

  const initial = await serverClaim(access.slug);

  return (
    <>
      <RememberTimezone />
      <HomeContainer
        orgSlug={access.slug}
        initial={initial ? { day: initial.day, data: initial.data } : null}
      />
    </>
  );
}
