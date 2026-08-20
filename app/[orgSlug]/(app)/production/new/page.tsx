import { requireOrgPage } from "../../_lib/stub-page";
import { ProductionContainer } from "@/components/production/production-container";

/**
 * Logging a batch. Two taps from anywhere via the quick action, and it is
 * staff work (CONTEXT.md — Org), so this is not owner-gated: the form shows
 * yields and orders, never costs.
 *
 * `?item=` preselects, which is what makes the calendar's start prompt two
 * taps rather than three. `?from=` says where to go afterwards: the default
 * lands on the production screen, and that route IS owner-only, so a staff
 * member arriving from the calendar has to be sent back to the calendar
 * rather than into a 404.
 */
export default async function NewProductionPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ item?: string; from?: string }>;
}) {
  const access = await requireOrgPage(params);
  const { item, from } = await searchParams;
  // Matched against a known value rather than used as a path. Taking the raw
  // string would let a crafted link bounce her somewhere else after a save.
  const doneHref = from === "calendar" ? `/${access.slug}/calendar` : undefined;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="type-display-sm pb-4">What did you make?</h1>
      <ProductionContainer
        orgSlug={access.slug}
        initialMenuItemId={item}
        doneHref={doneHref}
      />
    </div>
  );
}
