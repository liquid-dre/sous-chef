"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import { ProductionForm, type NeedsMakingRow } from "./production-form";

export function ProductionContainer({
  orgSlug,
  initialMenuItemId,
  doneHref,
}: {
  orgSlug: string;
  /** Preselect one item — the calendar links here from a start prompt, and
   * "log production two taps from any calendar entry" only works if the
   * second tap is Save rather than Find-the-item-again. */
  initialMenuItemId?: string;
  /**
   * Where to go after saving. Defaults to the production screen, which is
   * OWNER-ONLY (`app/[orgSlug]/(app)/production/page.tsx:13`) — so a staff
   * member who logged a batch used to land on a 404. Staff reach this form
   * from the quick action and now from the calendar, so the caller says where
   * they came from.
   */
  doneHref?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const day = useClientToday();

  const rows = useQuery(
    api.production.whatNeedsMaking,
    day ? { orgSlug, today: day } : "skip",
  );
  const log = useMutation(api.production.log);
  const logWithSub = useMutation(api.production.logWithSub);

  // What the form is currently pointed at, lifted here so the sub-recipe
  // check can be a query rather than something the form computes. It moves
  // only when she changes item or batch count.
  const [asking, setAsking] = React.useState<{
    menuItemId: string | null;
    batchCount: number;
  }>({ menuItemId: null, batchCount: 1 });

  const shortfalls = useQuery(
    api.production.subRecipeCheck,
    asking.menuItemId
      ? {
          orgSlug,
          menuItemId: asking.menuItemId as Id<"menuItems">,
          batchCount: asking.batchCount,
        }
      : "skip",
  );

  if (!rows) return <RouteLoading />;

  return (
    <ProductionForm
      rows={rows as NeedsMakingRow[]}
      initialMenuItemId={initialMenuItemId}
      saving={saving}
      subShortfalls={shortfalls ?? []}
      onSelectionChange={(menuItemId, batchCount) =>
        setAsking({ menuItemId, batchCount })
      }
      onLog={async (draft) => {
        setSaving(true);
        try {
          const args = {
            orgSlug,
            menuItemId: draft.menuItemId as Id<"menuItems">,
            batchCount: draft.batchCount,
            // The form works in whole units because she does; the schema
            // works in milli-units because everything else does.
            actualYieldMilli: Math.round(draft.actualUnits * 1000),
            orderIds: draft.orderIds as Id<"orders">[],
            day,
            wasteQtyMilli: draft.wasteUnits
              ? Math.round(draft.wasteUnits * 1000)
              : undefined,
            wasteReason: draft.wasteReason || undefined,
          };
          // Two mutations rather than one that takes an empty array, so the
          // ordinary bake keeps the exact call it has always made and nothing
          // about the common path changes shape.
          if (draft.subs.length > 0) {
            await logWithSub({
              ...args,
              subs: draft.subs.map((s) => ({
                menuItemId: s.menuItemId as Id<"menuItems">,
                batchCount: s.batchCount,
              })),
            });
          } else {
            await log(args);
          }
          router.push(doneHref ?? `/${orgSlug}/production`);
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}
