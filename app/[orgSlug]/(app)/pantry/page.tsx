import { requireOrgPage } from "../_lib/stub-page";
import { PantryContainer } from "@/components/pantry/pantry-container";

export default async function PantryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <PantryContainer orgSlug={access.slug} />;
}
