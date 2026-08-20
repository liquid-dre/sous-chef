import { requireOrgPage } from "../_lib/stub-page";
import { CalendarContainer } from "@/components/calendar/calendar-container";

/**
 * The calendar — and the screen STAFF LAND ON.
 *
 * `app/[orgSlug]/(app)/page.tsx:28` redirects staff here on sign-in
 * (CONTEXT.md — Routes), so this is deliberately NOT owner-gated. The role is
 * resolved here and passed down rather than discarded, which is what lets the
 * container skip the owner-only queries entirely for staff instead of firing
 * them and catching a FORBIDDEN.
 */
export default async function CalendarPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params);
  return (
    <CalendarContainer
      orgSlug={access.slug}
      isOwner={access.role === "owner"}
    />
  );
}
