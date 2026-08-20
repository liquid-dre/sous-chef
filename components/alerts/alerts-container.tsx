"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import { AlertsScreen, type SeverityFilter } from "./alerts-screen";
import type { AlertRow } from "./alert-card";
import type { BaseUnit } from "@/components/pantry/format";

export function AlertsContainer({ orgSlug }: { orgSlug: string }) {
  // HER day. Which orders fall inside the rolling seven days is a question
  // about her calendar, and Convex runs UTC (lib/day.ts).
  const today = useClientToday();
  const [filter, setFilter] = React.useState<SeverityFilter>("all");
  const [busy, setBusy] = React.useState(false);

  // Filtering happens on the CLIENT from one payload rather than by
  // re-querying per pill: the counts have to come from the unfiltered set
  // anyway, so a server round trip per tap would buy nothing and cost a
  // flash of empty list on a slow connection.
  const data = useQuery(api.alerts.list, today ? { orgSlug, today } : "skip");
  const resolve = useMutation(api.alerts.resolve);
  const unresolve = useMutation(api.alerts.unresolve);
  const setIngredientMute = useMutation(api.orgs.setIngredientAlertMute);
  const setGlobalMute = useMutation(api.alerts.setGlobalMute);

  if (data === undefined) return <RouteLoading />;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertsScreen
      filter={filter}
      onFilterChange={setFilter}
      busy={busy}
      stocktakeHref={`/${orgSlug}/pantry/stocktake`}
      data={{
        open: data.open as unknown as AlertRow[],
        suppressed: data.suppressed.map((s) => ({
          subjectKey: s.subjectKey,
          name: s.name,
        })),
        resolved: data.resolved.map((r) => ({
          id: r.id,
          severity: r.severity,
          message: r.message,
          resolvedAt: r.resolvedAt,
        })),
        runways: data.runways.map((r) => ({
          ingredientId: r.ingredientId,
          name: r.name,
          baseUnit: r.baseUnit as BaseUnit,
          onHandMilli: r.onHandMilli,
          bookedMilli: r.bookedMilli,
          daysOfCover: r.daysOfCover,
          severity: r.severity,
          muted: r.muted,
        })),
        trust: data.trust,
        daysSinceCount: data.confidence.daysSinceCount,
        orderCount: data.orderCount,
        demandBatches: data.demandBatches,
        horizonEnd: data.horizonEnd,
        horizonDays: data.horizonDays,
        globallyMuted: data.globallyMuted,
        mutedIngredients: data.mutedIngredients,
        counts: data.counts,
      }}
      onResolve={(row, message) =>
        run(() =>
          resolve({
            orgSlug,
            subjectKey: row.subjectKey,
            subjectId: row.subjectId,
            type: row.type,
            severity: row.severity,
            // The sentence she was looking at, stored verbatim — the history
            // has to be what she saw, not what today's data would say.
            message,
            shortfallMilli: row.shortfallMilli,
          }),
        )
      }
      onUnresolve={(id) =>
        run(() => unresolve({ orgSlug, alertId: id as Id<"alerts"> }))
      }
      onMuteIngredient={(ingredientId) =>
        run(() =>
          setIngredientMute({
            orgSlug,
            ingredientId: ingredientId as Id<"ingredients">,
            muted: true,
          }),
        )
      }
      onUnmuteIngredient={(ingredientId) =>
        run(() =>
          setIngredientMute({
            orgSlug,
            ingredientId: ingredientId as Id<"ingredients">,
            muted: false,
          }),
        )
      }
      onGlobalMute={(muted) => run(() => setGlobalMute({ orgSlug, muted }))}
    />
  );
}
