"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import { ContactDetail } from "./contact-detail";
import type { ContactDetail as Detail, Reminder } from "./types";

export function ContactContainer({
  orgSlug,
  customerId,
}: {
  orgSlug: string;
  customerId: string;
}) {
  const today = useClientToday();
  const [busy, setBusy] = React.useState(false);

  const data = useQuery(
    api.customers.get,
    today ? { orgSlug, customerId: customerId as Id<"customers">, today } : "skip",
  );
  const optOut = useMutation(api.customers.optOut);
  const setNotes = useMutation(api.customers.setNotes);
  const markReminder = useMutation(api.customers.markReminder);

  if (data === undefined) return <RouteLoading />;

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
    <ContactDetail
      contact={data as unknown as Detail}
      orgSlug={orgSlug}
      busy={busy}
      onOptOut={async () => {
        await optOut({ orgSlug, customerId: customerId as Id<"customers"> });
      }}
      onSaveNotes={async (notes) => {
        await setNotes({
          orgSlug,
          customerId: customerId as Id<"customers">,
          notes,
        });
      }}
      onMessaged={(reminder, body) => mark(reminder, body, "sent")}
      onDismiss={(reminder) => mark(reminder, "", "dismissed")}
    />
  );
}
