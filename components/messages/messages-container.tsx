"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import { MessagesScreen } from "./messages-screen";
import type { OutboxData, QueueRow, ScheduleRow } from "./types";

export function MessagesContainer({
  orgSlug,
  emailConfigured,
}: {
  orgSlug: string;
  /** Resolved on the server from `mailFrom()`. The email action is hidden
   * rather than failing on tap when no domain is connected. */
  emailConfigured: boolean;
}) {
  const router = useRouter();
  // Her day. Which weekday it is decides whether a recurring draft is due,
  // and the server runs UTC (lib/day.ts).
  const today = useClientToday();

  /**
   * Rows with a mutation in flight — a Set, not a boolean.
   *
   * With twenty rows a single flag would grey out the whole queue every time
   * she answered one, which on a slow connection means the list flickers off
   * and back on between every message.
   */
  const [inFlight, setInFlight] = React.useState<ReadonlySet<string>>(new Set());
  /** Row id → the sentence the send came back with. Per row for the same
   * reason `inFlight` is: one bounced address is not twenty failures. */
  const [errors, setErrors] = React.useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  const data = useQuery(api.messages.outbox, today ? { orgSlug, today } : "skip");
  const schedules = useQuery(
    api.messages.schedules,
    today ? { orgSlug, today } : "skip",
  );

  const markOpened = useMutation(api.messages.markOpened);
  const markSent = useMutation(api.messages.markSent);
  const markSkipped = useMutation(api.messages.markSkipped);
  const dismissDue = useMutation(api.messages.dismissDue);
  const markReminder = useMutation(api.customers.markReminder);

  if (data === undefined || schedules === undefined) return <RouteLoading />;

  const run = (id: string, work: () => Promise<unknown>) => {
    setInFlight((prev) => new Set(prev).add(id));
    void work().finally(() =>
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    );
  };

  return (
    <MessagesScreen
      data={data as OutboxData}
      schedules={schedules as ScheduleRow[]}
      orgSlug={orgSlug}
      inFlight={inFlight}
      // Fired as the anchor navigates. Not awaited — iOS is strict about what
      // counts as inside the click, and spending the gesture on a round trip
      // is how a link stops opening.
      onOpen={(row: QueueRow) =>
        run(row.id, () => markOpened({ orgSlug, outboxId: row.id as Id<"outbox"> }))
      }
      onSent={(row: QueueRow) =>
        run(row.id, () => markSent({ orgSlug, outboxId: row.id as Id<"outbox"> }))
      }
      onSkip={(row: QueueRow) =>
        run(row.id, () => markSkipped({ orgSlug, outboxId: row.id as Id<"outbox"> }))
      }
      emailConfigured={emailConfigured}
      errors={errors}
      // Email goes through a Next route rather than a mutation: there is no
      // action wrapper in convex/lib/functions.ts, and Resend is a network
      // call. The route marks the row sent only after the provider took it,
      // so the queue re-renders off the server rather than off a guess here.
      onSendEmail={(row: QueueRow) =>
        run(row.id, async () => {
          setErrors((prev) => {
            const next = new Map(prev);
            next.delete(row.id);
            return next;
          });
          try {
            const response = await fetch("/api/messages/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orgSlug, outboxId: row.id }),
            });
            const result = (await response.json()) as {
              ok: boolean;
              message?: string;
            };
            if (!result.ok) {
              setErrors((prev) =>
                new Map(prev).set(
                  row.id,
                  result.message ?? "Couldn't send it. Nothing was sent.",
                ),
              );
            }
          } catch {
            setErrors((prev) =>
              new Map(prev).set(
                row.id,
                "Couldn't reach the network. Nothing was sent.",
              ),
            );
          }
        })
      }
      // The recipient review is its own screen: she is about to write to
      // forty people and the list of who is excluded and why does not belong
      // squeezed into a card.
      onStartDraft={(draft) =>
        router.push(
          `/${orgSlug}/messages/send?template=${draft.templateId}&key=${encodeURIComponent(draft.key)}`,
        )
      }
      onDismissDraft={(draft) =>
        run(draft.key, () =>
          dismissDue({ orgSlug, scheduleKey: draft.key, body: draft.body }),
        )
      }
      onMessageReminder={(reminder, body) =>
        run(reminder.key, () =>
          markReminder({
            orgSlug,
            reminderKey: reminder.key,
            customerId: reminder.customerId as Id<"customers">,
            body,
            action: "sent",
          }),
        )
      }
    />
  );
}
