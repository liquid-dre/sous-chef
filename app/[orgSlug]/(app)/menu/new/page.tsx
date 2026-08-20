import { requireOrgPage } from "../../_lib/stub-page";
import { BuilderContainer } from "@/components/menu/builder-container";

export default async function NewMenuItemPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <BuilderContainer orgSlug={access.slug} />;
}
