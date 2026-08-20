import { requireOrgPage } from "../_lib/stub-page";
import { MessagesContainer } from "@/components/messages/messages-container";
import { mailFrom } from "@/lib/mailer";

/**
 * The outbox. Owner-only: it carries the whole customer list and every
 * message goes out under her name (CONTEXT.md — Org roles).
 */
export default async function MessagesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  // Resolved here rather than in the client: `mailFrom()` reads server-only
  // env, and a queue that offers "Email Grace" on a kitchen with no connected
  // domain is a button that fails on tap.
  return (
    <MessagesContainer
      orgSlug={access.slug}
      emailConfigured={mailFrom() !== null}
    />
  );
}
