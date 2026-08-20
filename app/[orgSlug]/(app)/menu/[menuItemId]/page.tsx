import { requireOrgPage } from "../../_lib/stub-page";
import { BuilderContainer } from "@/components/menu/builder-container";

export default async function MenuItemPage({
  params,
}: {
  params: Promise<{ orgSlug: string; menuItemId: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  const { menuItemId } = await params;
  return <BuilderContainer orgSlug={access.slug} menuItemId={menuItemId} />;
}
