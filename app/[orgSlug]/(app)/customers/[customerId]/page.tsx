import { requireOrgPage } from "../../_lib/stub-page";
import { ContactContainer } from "@/components/customers/contact-container";

export default async function ContactPage({
  params,
}: {
  params: Promise<{ orgSlug: string; customerId: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  const { customerId } = await params;
  return <ContactContainer orgSlug={access.slug} customerId={customerId} />;
}
