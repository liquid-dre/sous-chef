import { requireOrgPage } from "../../_lib/stub-page";
import { SendContainer } from "@/components/messages/send-container";

/**
 * Reviewing recipients before a batch starts. `?template=` says what to send
 * and `?key=` ties it back to the recurring draft it answers, so starting the
 * batch also stops that draft reappearing this week.
 */
export default async function SendPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ template?: string; key?: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  const { template, key } = await searchParams;
  return (
    <SendContainer
      orgSlug={access.slug}
      templateId={template ?? null}
      scheduleKey={key ?? null}
    />
  );
}
