import { notFound } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { resolveOrgAccess, type OrgAccess } from "@/lib/auth/org";
import { currentImpersonation } from "@/lib/admin/impersonation";
import { EmptyState } from "@/components/empty-state";

/**
 * The per-page half of the render-time guard. Every route in the shell calls
 * it, and it 404s a non-member exactly as the layout does.
 *
 * A super user holding an open session on THIS kitchen is the one exception,
 * and it has to be here as well as in the layout — the layout passing is not
 * enough when the page refuses independently. They resolve as owner, which is
 * what makes `{ ownerOnly: true }` pages reachable; the read-only guarantee is
 * not this function's job and never was. It belongs to
 * convex/lib/functions.ts, where the writes actually happen.
 */
export async function requireOrgPage(
  params: Promise<{ orgSlug: string }>,
  options?: { ownerOnly?: boolean },
): Promise<OrgAccess> {
  const { orgSlug } = await params;
  const access = await resolveOrgAccess(orgSlug);
  if (!access) {
    const viewing = await currentImpersonation();
    if (viewing?.orgSlug !== orgSlug) notFound();
    return {
      orgId: viewing.orgId,
      slug: viewing.orgSlug,
      name: viewing.orgName,
      role: "owner",
    };
  }
  if (options?.ownerOnly && access.role !== "owner") notFound();
  return access;
}

export function StubPage({
  icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-12">
      <EmptyState icon={icon} title={title} body={body} />
    </div>
  );
}
