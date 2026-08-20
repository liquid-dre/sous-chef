"use client";

import * as React from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatMoneyExact } from "@/components/charts-sous/format";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/day";
import { ReminderCard } from "./reminder-card";
import type { ContactRow, Reminder } from "./types";

/**
 * The contact list, which builds itself from orders.
 *
 * "Reach out before these" sits ABOVE the list, and that ordering is the
 * whole screen. A contact list is a reference; a reminder is a thing to do
 * today. Putting the to-do first is what makes this a screen she opens on
 * purpose rather than one she visits to look somebody up.
 *
 * Free of Convex so the specimen can mount every state.
 */

export function CustomersScreen({
  rows,
  reminders,
  optedOutCount,
  orgSlug,
  onMessaged,
  onDismiss,
  busy,
}: {
  rows: ContactRow[];
  reminders: Reminder[];
  optedOutCount: number;
  orgSlug: string;
  onMessaged: (reminder: Reminder, body: string) => void;
  onDismiss: (reminder: Reminder) => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="type-display">Customers</h1>
        <p className="type-body text-muted-foreground">
          {rows.length === 0
            ? "Every customer is keyed by the number you WhatsApp them on."
            : `${rows.length} ${rows.length === 1 ? "person" : "people"}, added by their first order.`}
        </p>
      </div>

      {/* The to-do, first. */}
      {reminders.length > 0 && (
        <section aria-label="Reach out before these" className="flex flex-col gap-2">
          <h2 className="type-title">Reach out before these</h2>
          <ul className="flex flex-col gap-2">
            {reminders.map((reminder) => (
              <ReminderCard
                key={reminder.key}
                reminder={reminder}
                busy={busy}
                onMessaged={(body) => onMessaged(reminder, body)}
                onDismiss={() => onDismiss(reminder)}
              />
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers yet"
          body="Take an order and the person it is for appears here, with what they have spent and what they are worth."
          actionLabel="Take an order"
          actionHref={`/${orgSlug}/orders/new`}
        />
      ) : (
        <section aria-label="Contacts" className="flex flex-col gap-2">
          {reminders.length > 0 && <h2 className="type-title">Everyone</h2>}
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/${orgSlug}/customers/${row.id}`}
                  className={cn(
                    "flex min-h-14 items-center justify-between gap-3 px-4 py-2.5",
                    "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    "hover:bg-muted",
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="type-body truncate">{row.name}</span>
                    <span className="type-caption text-muted-foreground">
                      {row.orders === 0
                        ? "No delivered orders yet"
                        : `${row.orders} ${row.orders === 1 ? "order" : "orders"}`}
                      {row.lastOrderedOn && (
                        <> · last {formatDay(row.lastOrderedOn)}</>
                      )}
                      {/* Stated on the row, not hidden on the detail page —
                          she needs to know before she plans a campaign. */}
                      {row.optedOut && <> · opted out</>}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="numeric-sm">
                      {formatMoneyExact(row.lifetimeRevenueCents)}
                    </span>
                    <span className="type-caption text-muted-foreground">
                      {/* PROFIT beside revenue, because the customer who
                          spends most is not necessarily the one worth most —
                          the same reframe 4.1 makes about menu items. */}
                      <span className="numeric">
                        {formatMoneyExact(row.lifetimeProfitCents)}
                      </span>{" "}
                      profit
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {optedOutCount > 0 && (
            <p className="type-caption text-muted-foreground">
              <span className="numeric">{optedOutCount}</span>{" "}
              {optedOutCount === 1 ? "person has" : "people have"} opted out of
              marketing. They never appear above, and only they can reverse it.
            </p>
          )}
        </section>
      )}

      {/* Only when there is genuinely nothing to do, and only once there are
          people — an empty kitchen has its own empty state above. */}
      {rows.length > 0 && reminders.length === 0 && (
        <p className="type-caption text-muted-foreground">
          Nobody to reach out to this week. Reminders appear here before a
          birthday or anniversary comes round again.
        </p>
      )}
    </div>
  );
}
