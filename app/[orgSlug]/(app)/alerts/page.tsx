import { requireOrgPage } from "../_lib/stub-page";
import { AlertsContainer } from "@/components/alerts/alerts-container";

export default async function AlertsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <AlertsContainer orgSlug={access.slug} />;
}
