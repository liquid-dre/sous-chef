import { requireOrgPage } from "../../_lib/stub-page";
import { InsightsContainer } from "@/components/dashboard/insights-container";

/** Owner only — every figure here is a margin (CONTEXT.md — Access). The
 * data layer refuses staff too, so this gate is the cheap early 404. */
export default async function InsightsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <InsightsContainer orgSlug={access.slug} view="items" />;
}
