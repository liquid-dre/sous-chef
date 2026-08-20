import { requireOrgPage } from "../../_lib/stub-page";
import { SavedOrderContainer } from "@/components/orders/saved-order-container";
import { mailFrom } from "@/lib/mailer";

/** Where saving lands, and where an order gets cancelled. */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ orgSlug: string; orderId: string }>;
}) {
  const access = await requireOrgPage(
    params as Promise<{ orgSlug: string }>,
  );
  const { orderId } = await params;
  return (
    <SavedOrderContainer
      orgSlug={access.slug}
      orderId={orderId}
      // Server-only env, resolved here: the browser cannot see whether a
      // sending domain is connected, and offering an Email button that can
      // only ever fail is worse than not offering one.
      emailConfigured={mailFrom() !== null}
    />
  );
}
