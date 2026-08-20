import { requireOrgPage } from "../_lib/stub-page";
import { ProfileContainer } from "@/components/settings/profile-container";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <ProfileContainer orgSlug={access.slug} mode="settings" />;
}
