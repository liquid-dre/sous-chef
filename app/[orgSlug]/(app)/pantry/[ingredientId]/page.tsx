import { requireOrgPage } from "../../_lib/stub-page";
import { IngredientContainer } from "@/components/pantry/ingredient-container";

export default async function IngredientPage({
  params,
}: {
  params: Promise<{ orgSlug: string; ingredientId: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  const { ingredientId } = await params;
  return (
    <IngredientContainer orgSlug={access.slug} ingredientId={ingredientId} />
  );
}
