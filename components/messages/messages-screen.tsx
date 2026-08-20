"use client";

import * as React from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { WEEKDAY_LABEL } from "@/convex/lib/messages";
import { reorderDraft, waLink } from "@/lib/whatsapp";
import { formatDay } from "@/lib/day";
import { QueueRunner } from "./queue-runner";
import type { DueDraft, OutboxData, Reminder, ScheduleRow } from "./types";

/**
 * The outbox: what is waiting for her, in the order she can act on it.
 *
 * Nothing here sends. Every item is a draft with her name on it, and the
 * furthest any of them goes without a tap is opening WhatsApp with the words
 * already in the box (CONTEXT.md — Comms: "Every message is drafted for
 * approval. Nothing auto-sends.").
 *
 * Order matters: a batch in progress first, because abandoning one half-done
 * is the failure the queue exists to prevent; then today's recurring draft;
 * then the reorder reminders, which are dated and can wait a day.
 *
 * Free of Convex so the specimen can mount every state — including a queue
 * stopped half-way, which is the one worth reviewing.
 */
export function MessagesScreen({
  data,
  schedules,
  orgSlug,
  inFlight,
  onOpen,
  onSent,
  onSkip,
  onSendEmail,
  emailConfigured,
  errors,
  onStartDraft,
  onDismissDraft,
  onMessageReminder,
}: {
  data: OutboxData;
  schedules: ScheduleRow[];
  orgSlug: string;
  inFlight: ReadonlySet<string>;
  onOpen: (row: OutboxData["queue"][number]) => void;
  onSent: (row: OutboxData["queue"][number]) => void;
  onSkip: (row: OutboxData["queue"][number]) => void;
  onSendEmail: (row: OutboxData["queue"][number]) => void;
  emailConfigured: boolean;
  errors: ReadonlyMap<string, string>;
  onStartDraft: (draft: DueDraft) => void;
  onDismissDraft: (draft: DueDraft) => void;
  onMessageReminder: (reminder: Reminder, body: string) => void;
}) {
  // Reminders she has tapped through to WhatsApp, awaiting her answer. Local
  // on purpose — see `components/customers/reminder-card.tsx`: nothing is
  // recorded until she says it went, so a reload brings the reminder back
  // rather than losing it to a message that never sent.
  const [openedReminders, setOpenedReminders] = React.useState<
    ReadonlySet<string>
  >(new Set());

  const nothing =
    data.queue.length === 0 &&
    data.dueDrafts.length === 0 &&
    data.reminders.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-display">Messages</h1>
          <p className="type-body text-muted-foreground">
            Everything here is a draft. You send from your own number.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="min-h-11 md:min-h-9" asChild>
            <Link href={`/${orgSlug}/messages/templates`}>Templates</Link>
          </Button>
          <Button variant="outline" className="min-h-11 md:min-h-9" asChild>
            <Link href={`/${orgSlug}/messages/campaigns`}>Campaigns</Link>
          </Button>
        </div>
      </div>

      {nothing ? (
        <EmptyState
          icon={MessageCircle}
          title="No drafts waiting"
          body="Reorder reminders land here before a birthday comes round, and a weekly schedule puts a draft here on the day you choose. Nothing sends itself."
          actionLabel="Write a template"
          actionHref={`/${orgSlug}/messages/templates`}
        />
      ) : (
        <>
          {/* A batch in progress, first. Leaving one half-sent is the thing
              the queue exists to prevent. */}
          {data.queue.length > 0 && (
            <QueueRunner
              rows={data.queue}
              doneToday={data.doneToday}
              inFlight={inFlight}
              onOpen={onOpen}
              onSent={onSent}
              onSkip={onSkip}
              onSendEmail={onSendEmail}
              emailConfigured={emailConfigured}
              errors={errors}
            />
          )}

          {data.dueDrafts.length > 0 && (
            <section aria-label="Due today" className="flex flex-col gap-2">
              <h2 className="type-title">Due today</h2>
              <ul className="flex flex-col gap-2">
                {data.dueDrafts.map((draft) => (
                  <li
                    key={draft.key}
                    className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5"
                  >
                    <div className="flex flex-col gap-0.5">
                      <p className="type-label">{draft.templateName}</p>
                      <p className="type-caption text-pretty text-muted-foreground">
                        {draft.body}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        className="min-h-11 md:min-h-9"
                        onClick={() => onStartDraft(draft)}
                      >
                        Review recipients
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 md:min-h-9"
                        onClick={() => onDismissDraft(draft)}
                      >
                        Not this week
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.reminders.length > 0 && (
            <section aria-label="Reorder reminders" className="flex flex-col gap-2">
              <h2 className="type-title">Reach out before these</h2>
              <ul className="flex flex-col gap-2">
                {data.reminders.map((reminder) => {
                  const body = reorderDraft({
                    customerName: reminder.customerName,
                    itemName: reminder.itemName,
                    lastOrderedOn: reminder.lastOrderedOn,
                  });
                  const href = waLink(reminder.phone, body);
                  return (
                    <li
                      key={reminder.key}
                      className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5"
                    >
                      <div className="flex flex-col gap-0.5">
                        <p className="type-label">{reminder.customerName}</p>
                        <p className="type-caption text-muted-foreground">
                          Comes round {formatDay(reminder.dueOn)}
                        </p>
                      </div>
                      {openedReminders.has(reminder.key) ? (
                        // She has been to WhatsApp. Only her answer records a
                        // send — the browser cannot see into another app.
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="type-caption text-muted-foreground">
                            Did it send?
                          </span>
                          <Button
                            size="sm"
                            className="min-h-11 md:min-h-9"
                            disabled={inFlight.has(reminder.key)}
                            onClick={() => onMessageReminder(reminder, body)}
                          >
                            Sent
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-11 md:min-h-9"
                            onClick={() =>
                              setOpenedReminders((prev) => {
                                const next = new Set(prev);
                                next.delete(reminder.key);
                                return next;
                              })
                            }
                          >
                            Not yet
                          </Button>
                        </div>
                      ) : (
                        href && (
                          <div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11 md:min-h-9"
                              asChild
                            >
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() =>
                                  setOpenedReminders((prev) =>
                                    new Set(prev).add(reminder.key),
                                  )
                                }
                              >
                                Message {reminder.customerName.split(" ")[0]}
                              </a>
                            </Button>
                          </div>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {schedules.length > 0 && (
        <section
          aria-label="Recurring"
          className="flex flex-col gap-2 rounded-lg border bg-card p-4"
        >
          <h2 className="type-title">Every week</h2>
          <ul className="flex flex-col divide-y">
            {schedules.map((s) => (
              <li
                key={s.id}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <span className="min-w-0">
                  <span className="type-body block truncate">{s.templateName}</span>
                  <span className="type-caption text-muted-foreground">
                    {WEEKDAY_LABEL[s.weekday]}
                    {!s.active && " · paused"}
                  </span>
                </span>
                {s.dueToday && (
                  <span className="type-caption shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-primary">
                    today
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="type-caption text-muted-foreground">
            A draft appears here on the day. Nothing goes out until you send
            it.
          </p>
        </section>
      )}
    </div>
  );
}
