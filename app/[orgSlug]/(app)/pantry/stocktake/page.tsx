import { requireOrgPage } from "../../_lib/stub-page";
import { StocktakeContainer } from "@/components/pantry/stocktake-container";

export default async function StocktakePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <StocktakeContainer orgSlug={access.slug} />;
}
