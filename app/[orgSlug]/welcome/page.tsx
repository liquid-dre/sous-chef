import { notFound, redirect } from "next/navigation";
import { resolveOrgAccess } from "@/lib/auth/org";
import { OrgSync } from "@/components/shell/org-sync";
import { ProfileContainer } from "@/components/settings/profile-container";

/**
 * First-run onboarding — the same Business Profile component in its second
 * chrome: no shell, no nav, just the four fields and the preview. Staff have
 * nothing to onboard; owners who already finished get sent home (the
 * container handles that once data loads).
 */
export default async function WelcomePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const access = await resolveOrgAccess(orgSlug);
  if (!access) notFound();
  if (access.role === "staff") redirect(`/${orgSlug}/calendar`);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14">
      <OrgSync orgId={access.orgId} orgSlug={orgSlug} />
      <ProfileContainer orgSlug={orgSlug} mode="onboarding" />
    </main>
  );
}
