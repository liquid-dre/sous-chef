import { requireOrgPage } from "../_lib/stub-page";
import { LeakContainer } from "@/components/production/leak-container";

/**
 * Made against sold — the instrumentation for the biggest single leak in the
 * kitchen. Owner-only: every figure on it is a cost.
 */
export default async function ProductionPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params, { ownerOnly: true });
  return (
    <div className="mx-auto w-full max-w-3xl">
      <LeakContainer orgSlug={access.slug} />
    </div>
  );
}
