import { requireOrgPage } from "../_lib/stub-page";
import { OrdersListContainer } from "@/components/orders/orders-list-container";

/**
 * Orders: the bake list, the chase list and the archive, as three readings
 * of the same rows. Staff work orders too, so this is not owner-gated — the
 * list carries no costs, only what was charged and what has been paid.
 */
export default async function OrdersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <OrdersListContainer orgSlug={access.slug} />
    </div>
  );
}
