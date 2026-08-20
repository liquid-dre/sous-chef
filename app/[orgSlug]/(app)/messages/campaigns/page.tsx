import { requireOrgPage } from "../../_lib/stub-page";
import { CampaignsContainer } from "@/components/messages/campaigns-container";
import { mailFrom } from "@/lib/mailer";

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return (
    <CampaignsContainer
      orgSlug={access.slug}
      emailConfigured={mailFrom() !== null}
    />
  );
}
