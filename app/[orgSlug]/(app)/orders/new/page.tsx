import { requireOrgPage } from "../../_lib/stub-page";
import { OrderFormContainer } from "@/components/orders/order-form-container";

/**
 * Logging a sale. Order entry is staff work, so this is not owner-gated —
 * but costs are hers alone, and the role decides whether the margin block
 * and the delivery-cost field exist at all. The server refuses cost data
 * from a staff caller regardless.
 */
export default async function NewOrderPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="type-display-sm pb-4">A new order</h1>
      <OrderFormContainer
        orgSlug={access.slug}
        canSeeCosts={access.role === "owner"}
      />
    </div>
  );
}
