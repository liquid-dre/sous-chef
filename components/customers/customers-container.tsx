"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import { PeriodProvider, PeriodSwitcher, usePeriod } from "@/components/charts-sous/use-period";
import { boundsForDay } from "@/lib/period";
import { CustomersScreen } from "./customers-screen";
import type { ContactRow, Reminder } from "./types";

/**
 * The charts are dynamically imported for the reason every other screen does
 * it: the contact list is the useful part and it must not wait on the chart
 * bundle. The options object MUST be an object literal at each call site —
 * sharing one const compiles under `next dev` and fails `next build`
 * outright, because Turbopack reads these statically
 * (`components/dashboard/insights-container.tsx:33-36`).
 */
const skeleton = () => (
  <div className="h-64 animate-pulse rounded-lg border bg-card" />
);

const CustomerCharts = dynamic(
  () => import("./customer-charts").then((m) => m.CustomerCharts),
  { ssr: false, loading: skeleton },
);

export function CustomersContainer({ orgSlug }: { orgSlug: string }) {
  return (
    <PeriodProvider>
      <Inner orgSlug={orgSlug} />
    </PeriodProvider>
  );
}

function Inner({ orgSlug }: { orgSlug: string }) {
  // Her day. Which anniversaries are "coming up" is a question about her
  // calendar, and the server runs UTC (lib/day.ts).
  const today = useClientToday();
  const { period, label } = usePeriod();
  const [busy, setBusy] = React.useState(false);

  const data = useQuery(api.customers.list, today ? { orgSlug, today } : "skip");
  const markReminder = useMutation(api.customers.markReminder);

  if (data === undefined) return <RouteLoading />;

  const bounds = today ? boundsForDay(period, today) : null;

  const mark = (reminder: Reminder, body: string, action: "sent" | "dismissed") => {
    setBusy(true);
    void markReminder({
      orgSlug,
      reminderKey: reminder.key,
      customerId: reminder.customerId as Id<"customers">,
      body,
      action,
    }).finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-6">
      <CustomersScreen
        rows={data.rows as ContactRow[]}
        reminders={data.reminders}
        optedOutCount={data.optedOutCount}
        orgSlug={orgSlug}
        busy={busy}
        // Fired as WhatsApp opens. "Sent" is HER word — nothing in Sous ever
        // sends on its own (CONTEXT.md — Comms).
        onMessaged={(reminder, body) => mark(reminder, body, "sent")}
        onDismiss={(reminder) => mark(reminder, "", "dismissed")}
      />

      {data.rows.length > 0 && bounds && (
        <section aria-label="Customer insights" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="type-title">Where your money comes from</h2>
            <PeriodSwitcher />
          </div>
          <CustomerCharts
            orgSlug={orgSlug}
            start={bounds.start}
            end={bounds.end}
            periodLabel={label}
          />
        </section>
      )}
    </div>
  );
}
