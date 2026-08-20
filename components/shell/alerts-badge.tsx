"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useClientToday } from "@/components/use-client-today";

/**
 * Unresolved, unmuted alerts. Renders NOTHING while loading, when Convex is
 * unconfigured, or at zero — absence, never a spinner, never a hollow zero
 * (DESIGN.md: no number Sous can't stand behind). Mounted only in the owner
 * nav; the query itself rejects staff besides (convex/alerts.ts).
 *
 * `today` is HERS. The count is derived from the confirmed orders inside a
 * rolling seven days, and which orders those are is a question about her
 * calendar — Convex runs UTC (lib/day.ts).
 */
export function AlertsBadge({ orgSlug }: { orgSlug: string }) {
  const today = useClientToday();
  const data = useQuery(
    api.alerts.unresolvedCount,
    today ? { orgSlug, today } : "skip",
  );
  if (!data || data.count === 0) return null;
  return (
    <span
      aria-label={`${data.count} unresolved ${data.count === 1 ? "alert" : "alerts"}`}
      className={cn(
        // The badge wears the worst news in the pile — semantic, never brand.
        "numeric inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-caption font-semibold",
        data.hasRed
          ? "bg-loss text-white"
          : "bg-warn text-[oklch(0.2_0.02_75)]",
      )}
    >
      {data.count > 9 ? "9+" : data.count}
    </span>
  );
}
