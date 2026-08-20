import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { resolveOrgAccess } from "@/lib/auth/org";
import { currentImpersonation } from "@/lib/admin/impersonation";
import { AppShell } from "@/components/shell/app-shell";
import { ImpersonationBanner } from "@/components/shell/impersonation-banner";
import { OnboardingGate } from "@/components/shell/onboarding-gate";
import { OrgSync } from "@/components/shell/org-sync";
import { navForRole } from "@/components/shell/nav";
import { OrgTheme } from "@/components/theme/org-theme";

/**
 * The render-time tenancy guard: a signed-in non-member of this slug gets a
 * plain 404 — indistinguishable from an org that doesn't exist. The
 * data-layer guard is convex/lib/functions.ts, which trusts only the JWT.
 *
 * One exception, and it has to be taught to BOTH guards or it works in
 * neither: a super user holding an open impersonation session. Convex's
 * `resolveOrg` lets them read; without the same fallback here they would
 * never reach it, because `resolveOrgAccess` asks Clerk for a membership they
 * do not have.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // Promise<unknown> keeps this compatible with Next's generated layout
  // validator regardless of regeneration state; the shape is ours to assert.
  params: Promise<unknown>;
}) {
  const { orgSlug } = (await params) as { orgSlug: string };
  const { userId } = await auth();
  if (!userId) redirect("/sign-in"); // proxy already guards; belt and braces

  const access = await resolveOrgAccess(orgSlug);
  const viewing = access ? null : await currentImpersonation();
  // Not a member, and no open session for THIS kitchen. Same 404 as always.
  if (!access && viewing?.orgSlug !== orgSlug) notFound();

  const role = access?.role ?? "owner";
  const name = access?.name ?? viewing!.orgName;

  return (
    <AppShell
      orgSlug={orgSlug}
      orgName={name}
      items={navForRole(role)}
      banner={
        viewing ? (
          <ImpersonationBanner
            orgName={viewing.orgName}
            expiresAt={viewing.expiresAt}
          />
        ) : undefined
      }
    >
      {/* OrgSync sets Clerk's ACTIVE organization from the route so the JWT's
          org claims match. A super user is not a member of this kitchen, so
          there is nothing to make active — running it here would ask Clerk
          for something it will refuse, on every render. Impersonation gets
          its reach from the Convex session row instead. */}
      {access && <OrgSync orgId={access.orgId} orgSlug={orgSlug} />}
      <OrgTheme orgSlug={orgSlug} />
      {/* Never while viewing: the welcome screen is hers to complete, and a
          super user cannot write it anyway. */}
      {access?.role === "owner" && <OnboardingGate orgSlug={orgSlug} />}
      {children}
    </AppShell>
  );
}
