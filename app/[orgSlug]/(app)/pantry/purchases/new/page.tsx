import { requireOrgPage } from "../../../_lib/stub-page";
import { PurchaseContainer } from "@/components/pantry/purchase-container";

export default async function NewPurchasePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <PurchaseContainer orgSlug={access.slug} />;
}
