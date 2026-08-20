"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import { windowFor, type CalendarView } from "@/convex/lib/schedule";
import { CalendarScreen } from "./calendar-screen";
import type { CalendarData } from "./types";

/**
 * The charts are OWNER-ONLY and dynamically imported, which is two decisions
 * doing one job.
 *
 * Staff land on this screen by default and are on a phone in a kitchen. The
 * heatmap pulls in the whole vendored heatmap tree and the capacity bars pull
 * in the bar chart; neither is on the staff payload, so neither should be in
 * the staff bundle either.
 *
 * The options object MUST be an object literal at each call site — sharing
 * one const compiles under `next dev` and fails `next build` outright,
 * because Turbopack reads these statically to split the bundle
 * (`components/dashboard/insights-container.tsx:30-41`).
 */
const skeleton = () => (
  <div className="h-64 animate-pulse rounded-lg border bg-card" />
);

const OrderDensityHeatmap = dynamic(
  () => import("./order-density-heatmap").then((m) => m.OrderDensityHeatmap),
  { ssr: false, loading: skeleton },
);

const CapacityBars = dynamic(
  () => import("./capacity-bars").then((m) => m.CapacityBars),
  { ssr: false, loading: skeleton },
);

/** How far back the density heatmap looks. Declared HERE rather than imported
 * from the chart module — a constant read by the container drags the whole
 * dynamically-loaded module into the main bundle
 * (`recommendations-container.tsx:42-49`). */
const DENSITY_WEEKS = 12;

export function CalendarContainer({
  orgSlug,
  isOwner,
}: {
  orgSlug: string;
  /** From the server page, not from the payload — the route already resolved
   * the role, and asking the client to infer it from a missing key would be
   * a worse kind of truth. */
  isOwner: boolean;
}) {
  const today = useClientToday();
  const [view, setView] = React.useState<CalendarView>("week");
  const [anchorDay, setAnchorDay] = React.useState<string | null>(null);

  // Her day, from the browser. The server has no "today" (lib/day.ts), and
  // which week "this week" is is entirely a question about her calendar.
  const anchor = anchorDay ?? today;
  const range = anchor ? windowFor(view, anchor) : null;

  const data = useQuery(
    api.calendar.range,
    range && today ? { orgSlug, start: range.start, end: range.end, today } : "skip",
  );
  const density = useQuery(
    api.calendar.density,
    isOwner && today ? { orgSlug, end: today, weeks: DENSITY_WEEKS } : "skip",
  );

  if (data === undefined || !anchor) return <RouteLoading />;

  const capacity = (data as CalendarData).capacity;

  return (
    <CalendarScreen
      data={data as CalendarData}
      orgSlug={orgSlug}
      view={view}
      anchorDay={anchor}
      onViewChange={setView}
      onAnchorChange={setAnchorDay}
      isOwner={isOwner}
      charts={
        isOwner ? (
          <div className="flex flex-col gap-4">
            {capacity && capacity.byDay.length > 0 && (
              <CapacityBars
                byDay={capacity.byDay}
                ceilingHours={capacity.ceilingHours}
              />
            )}
            {density && (
              <OrderDensityHeatmap
                columns={density.columns}
                orderCount={density.orderCount}
              />
            )}
          </div>
        ) : null
      }
    />
  );
}
