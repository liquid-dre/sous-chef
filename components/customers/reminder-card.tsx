"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { formatDay, formatDayWithYear } from "@/lib/day";
import { reorderDraft, waLink } from "@/lib/whatsapp";
import { OCCASION_LABEL } from "@/convex/lib/contacts";
import type { Reminder } from "./types";

/**
 * One reorder reminder, and the sentence it exists to make.
 *
 * CONTEXT.md's example is the whole brief: "Last year Andre ordered a
 * birthday cake on 1 August. Reach out before then." A fact she can act on,
 * not a notification.
 *
 * The card states the fact and hands her a DRAFT. Nothing sends — wa.me opens
 * WhatsApp with the words already in the box and she changes whatever she
 * likes before hitting send from her own number (CONTEXT.md — Comms). So the
 * button says "Message" rather than "Send", because Sous is not the one
 * sending.
 *
 * Only two actions, and neither is destructive: message them, or not this
 * year. "Not this year" is scoped to the year on purpose — the same birthday
 * comes round again in twelve months and she may well want it then.
 *
 * SHE CONFIRMS THE SEND. Tapping through opens WhatsApp; the card then asks
 * whether it actually went, and only her answer records one. The browser
 * cannot see into another app, so treating the tap itself as a send means
 * opening WhatsApp, thinking better of it, and having Sous believe a message
 * went that never did — after which the reminder never comes back. The same
 * question the outbox queue asks, for the same reason.
 */
export function ReminderCard({
  reminder,
  onMessaged,
  onDismiss,
  busy,
}: {
  reminder: Reminder;
  /** Fired when SHE says it went — never on the tap that opened WhatsApp. */
  onMessaged: (body: string) => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  // Local, and deliberately so: nothing is recorded until she answers, so a
  // reload simply brings the reminder back unanswered. The only thing lost is
  // a tap, and the alternative is a stored "opened" that has to be cleaned up
  // for a question she may never come back to.
  const [opened, setOpened] = React.useState(false);
  const body = React.useMemo(
    () =>
      reorderDraft({
        customerName: reminder.customerName,
        itemName: reminder.itemName,
        lastOrderedOn: reminder.lastOrderedOn,
      }),
    [reminder],
  );
  const href = waLink(reminder.phone, body);

  const when =
    reminder.daysAway === 0
      ? "today"
      : reminder.daysAway === 1
        ? "tomorrow"
        : `in ${reminder.daysAway} days`;

  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="type-label">
          {reminder.customerName} ·{" "}
          {OCCASION_LABEL[reminder.occasion].toLowerCase()} {when}
        </p>
        {/* The fact, in her words, with the date she can check against. */}
        <p className="type-caption text-pretty text-muted-foreground">
          {/* The past date carries its YEAR and the future one carries its
              weekday. Without the year these are the same day of the month by
              definition, and two different weekdays on one date reads as a
              bug rather than as two different years. */}
          They ordered{" "}
          {reminder.itemName ? reminder.itemName.toLowerCase() : "from you"} for{" "}
          {formatDayWithYear(reminder.lastOrderedOn)}. Comes round again{" "}
          {formatDay(reminder.dueOn)}.
        </p>
      </div>

      {opened ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-caption text-muted-foreground">
            Did it send?
          </span>
          <Button
            size="sm"
            className="min-h-11 md:min-h-9"
            disabled={busy}
            onClick={() => onMessaged(body)}
          >
            Sent
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-9"
            disabled={busy}
            onClick={() => setOpened(false)}
          >
            Not yet
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {href ? (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 md:min-h-9"
              disabled={busy}
              asChild
            >
              {/* A real link, not a router push: WhatsApp is another app, and
                  middle-click / long-press-to-copy are worth keeping. */}
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpened(true)}
              >
                Message {reminder.customerName.split(" ")[0]}
              </a>
            </Button>
          ) : (
            <span className="type-caption text-muted-foreground">
              No number on file to message them on.
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-9"
            disabled={busy}
            onClick={onDismiss}
          >
            Not this year
          </Button>
        </div>
      )}
    </li>
  );
}
