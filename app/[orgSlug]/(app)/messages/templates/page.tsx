import { requireOrgPage } from "../../_lib/stub-page";
import { TemplatesContainer } from "@/components/messages/templates-container";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <TemplatesContainer orgSlug={access.slug} />;
}
