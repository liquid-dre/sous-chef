import { requireOrgPage } from "../../_lib/stub-page";
import { RecommendationsContainer } from "@/components/recommendations/recommendations-container";

/** Owner only — every figure here is a cost or a margin (CONTEXT.md — Access).
 * The data layer refuses staff too, so this gate is the cheap early 404. */
export default async function RecommendationsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <RecommendationsContainer orgSlug={access.slug} />;
}
