"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import type { ClerkOrg } from "@/lib/admin/clerk-orgs";
import {
  finishProvisioning,
  provisionKitchen,
} from "@/lib/admin/provision";
import { OrgTable } from "./org-table";
import { OrgDetail } from "./org-detail";
import { ProvisionForm, type ProvisionDraft } from "./provision-form";
import type { AdminOrgRow, ImpersonationRow, Plan } from "./types";

/**
 * The console.
 *
 * Clerk's list arrives from the server (it needs CLERK_SECRET_KEY and must
 * never reach the browser); the Sous half is a live Convex query, so a tier
 * change or a disable is reflected the instant the mutation lands rather than
 * after a refresh. Clerk is the SPINE of the join — an org with no Sous row is
 * a row here, not a gap.
 */
export function AdminContainer({ clerkOrgs }: { clerkOrgs: ClerkOrg[] }) {
  const router = useRouter();
  const today = useClientToday();
  const month = today ? today.slice(0, 7) : null;

  const [openOrgId, setOpenOrgId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const orgs = useQuery(api.admin.listOrgs, {});
  const usage = useQuery(api.admin.usage, month ? { month } : "skip");
  const history = useQuery(
    api.admin.impersonationHistory,
    openOrgId ? { orgId: openOrgId } : "skip",
  );

  const setPlan = useMutation(api.admin.setPlan);
  const setFoundingMember = useMutation(api.admin.setFoundingMember);
  const setDisabled = useMutation(api.admin.setDisabled);
  const startImpersonation = useMutation(api.admin.startImpersonation);

  if (orgs === undefined) return <RouteLoading />;

  const sousByOrgId = new Map(orgs.map((o) => [o.orgId, o]));
  const rows: AdminOrgRow[] = clerkOrgs.map((clerk) => {
    const sous = sousByOrgId.get(clerk.orgId);
    return {
      ...clerk,
      provisioned: sous !== undefined,
      plan: (sous?.plan as Plan | undefined) ?? null,
      foundingMember: sous?.foundingMember ?? null,
      disabled: sous?.disabled ?? null,
      // Absent while `today` is still "" on the server snapshot — 0 is the
      // honest placeholder for "not counted yet", and the figure arrives a
      // tick later rather than rendering a number Sous cannot stand behind.
      ordersThisMonth: usage?.counts[clerk.orgId] ?? 0,
    };
  });

  const open = rows.find((r) => r.orgId === openOrgId) ?? null;

  /** Every mutation from this screen shares the same shape: one field, then
   * the row behind the dialog updates. */
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <ProvisionForm
        busy={busy}
        error={error}
        notice={notice}
        onSubmit={(draft: ProvisionDraft) =>
          run(async () => {
            setNotice(null);
            const result = await provisionKitchen(draft);
            if (!result.ok) {
              setError(result.message);
              // A partial failure still created the Clerk org, so refresh:
              // the list is where she finishes it.
              if (result.orgId) router.refresh();
              return;
            }
            setNotice(
              result.invited
                ? `${draft.name} is ready. The invitation went to ${result.invited}.`
                : `${draft.name} is ready, but the invitation didn't send — invite ${draft.ownerEmail} from Clerk.`,
            );
            router.refresh();
          })
        }
      />

      <OrgTable rows={rows} onOpen={(row) => setOpenOrgId(row.orgId)} />

      <OrgDetail
        row={open}
        history={(history ?? []) as ImpersonationRow[]}
        busy={busy}
        error={error}
        onClose={() => {
          setOpenOrgId(null);
          setError(null);
        }}
        onPlan={(plan) =>
          run(() => setPlan({ orgId: open!.orgId, plan }))
        }
        onFoundingMember={(foundingMember) =>
          run(() => setFoundingMember({ orgId: open!.orgId, foundingMember }))
        }
        onDisabled={(disabled) =>
          run(() => setDisabled({ orgId: open!.orgId, disabled }))
        }
        onImpersonate={() =>
          run(async () => {
            await startImpersonation({ orgSlug: open!.slug });
            // Straight into her kitchen. The banner is rendered by the org
            // shell, which reads the session on the server.
            router.push(`/${open!.slug}`);
          })
        }
        onFinishProvisioning={() =>
          run(async () => {
            const result = await finishProvisioning({
              orgId: open!.orgId,
              slug: open!.slug,
              name: open!.name,
              foundingMember: false,
            });
            if (!result.ok) setError(result.message);
          })
        }
      />
    </div>
  );
}
