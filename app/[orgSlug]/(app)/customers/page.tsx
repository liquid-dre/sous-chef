import { requireOrgPage } from "../_lib/stub-page";
import { CustomersContainer } from "@/components/customers/customers-container";

/**
 * The contact list. Owner-only: every figure on it is profit, and marketing
 * consent is hers to manage (CONTEXT.md — Org roles).
 */
export default async function CustomersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return <CustomersContainer orgSlug={access.slug} />;
}
