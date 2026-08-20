"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDay } from "@/lib/day";
import { formatMoneyExact } from "@/components/charts-sous/format";
import { OCCASION_LABEL } from "@/convex/lib/contacts";
import { OptOutDialog } from "./opt-out-dialog";
import { ReminderCard } from "./reminder-card";
import type { ContactDetail as Detail, Reminder } from "./types";

/**
 * One person: what they have bought, what they are worth, and what she is
 * allowed to send them.
 *
 * LIFETIME, not period. A contact is a relationship and a relationship is
 * cumulative — showing "$0 this month" against someone she has known for two
 * years reads as a dead customer rather than a quiet month. The period-bounded
 * view of the same people is the three charts on the list screen.
 *
 * The consent control is the most consequential thing on the page and it is
 * therefore the plainest: a labelled button, no switch, no colour, and a
 * dialog that says what cannot be undone. A toggle would imply it toggles.
 *
 * Same shape as `components/pantry/ingredient-container.tsx`: back-link,
 * name, a derived subtitle, then stacked sections.
 */
export function ContactDetail({
  contact,
  orgSlug,
  onOptOut,
  onSaveNotes,
  onMessaged,
  onDismiss,
  busy,
}: {
  contact: Detail;
  orgSlug: string;
  onOptOut: () => Promise<void>;
  onSaveNotes: (notes: string) => Promise<void>;
  onMessaged: (reminder: Reminder, body: string) => void;
  onDismiss: (reminder: Reminder) => void;
  busy?: boolean;
}) {
  const [notes, setNotes] = React.useState(contact.notes ?? "");
  const [savingNotes, setSavingNotes] = React.useState(false);
  const dirty = notes.trim() !== (contact.notes ?? "").trim();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/${orgSlug}/customers`}
          className="type-caption inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          Customers
        </Link>
        <h1 className="type-display mt-1">{contact.name}</h1>
        <p className="type-body text-muted-foreground">
          {contact.phone}
          {contact.email && <> · {contact.email}</>}
        </p>
      </div>

      {/* Lifetime, stated as three figures rather than one — revenue alone
          would let the biggest spender look like the best customer. */}
      <section
        aria-label="What they are worth"
        className="grid grid-cols-3 gap-3 rounded-lg border bg-card p-4"
      >
        {[
          ["Orders", String(contact.orders)],
          ["Lifetime", formatMoneyExact(contact.lifetimeRevenueCents)],
          ["Profit", formatMoneyExact(contact.lifetimeProfitCents)],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="type-caption text-muted-foreground">{label}</span>
            <span className="numeric-body">{value}</span>
          </div>
        ))}
        {contact.marginPercent !== null && (
          <p className="type-caption col-span-3 text-muted-foreground">
            You keep <span className="numeric">{contact.marginPercent}%</span> of
            what they spend, across everything they have ever ordered.
          </p>
        )}
      </section>

      {contact.reminders.length > 0 && (
        <section aria-label="Coming up" className="flex flex-col gap-2">
          <h2 className="type-title">Coming up</h2>
          <ul className="flex flex-col gap-2">
            {contact.reminders.map((r) => (
              <ReminderCard
                key={r.key}
                reminder={r}
                busy={busy}
                onMessaged={(body) => onMessaged(r, body)}
                onDismiss={() => onDismiss(r)}
              />
            ))}
          </ul>
        </section>
      )}

      {contact.occasions.length > 0 && (
        <section
          aria-label="What they order for"
          className="flex flex-col gap-2 rounded-lg border bg-card p-4"
        >
          <h2 className="type-title">What they order for</h2>
          <ul className="flex flex-wrap gap-2">
            {contact.occasions.map((o) => (
              <li
                key={o.occasion}
                className="type-caption rounded-full border px-3 py-1"
              >
                {OCCASION_LABEL[o.occasion]} ·{" "}
                <span className="numeric">{o.orders}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-label="Order history"
        className="flex flex-col gap-2 rounded-lg border bg-card p-4"
      >
        <h2 className="type-title">Every order</h2>
        {contact.history.length === 0 ? (
          <p className="type-body text-muted-foreground">
            Nothing delivered yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {contact.history.map((h) => (
              <li key={h.orderId} className="flex items-baseline justify-between gap-3 py-2">
                <Link
                  href={`/${orgSlug}/orders/${h.orderId}`}
                  className="min-w-0 flex-1 underline-offset-4 hover:underline"
                >
                  <span className="type-body">{formatDay(h.deliveryDate)}</span>
                  <span className="type-caption block text-muted-foreground">
                    {h.occasion ? OCCASION_LABEL[h.occasion] : "No occasion"}
                    {/* Already computed by rankOrders and thrown away by
                        rankCustomers — carried up because "why was this one
                        thin" is the question a history invites. */}
                    {h.reason && <> · {h.reason}</>}
                  </span>
                </Link>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="numeric-sm">{formatMoneyExact(h.revenueCents)}</span>
                  <span className="type-caption text-muted-foreground">
                    <span className="numeric">{formatMoneyExact(h.profitCents)}</span>{" "}
                    profit
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label="Notes"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      >
        <Label htmlFor="contact-notes" className="type-title">
          Notes
        </Label>
        <Textarea
          id="contact-notes"
          value={notes}
          rows={3}
          placeholder="Allergic to walnuts. Prefers collection."
          onChange={(e) => setNotes(e.target.value)}
        />
        {dirty && (
          <div>
            <Button
              size="sm"
              className="min-h-11 md:min-h-9"
              disabled={savingNotes}
              onClick={async () => {
                setSavingNotes(true);
                try {
                  await onSaveNotes(notes);
                } finally {
                  setSavingNotes(false);
                }
              }}
            >
              {savingNotes ? "Saving…" : "Save note"}
            </Button>
          </div>
        )}
      </section>

      <section
        aria-label="Marketing"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      >
        <h2 className="type-title">Marketing</h2>
        {contact.optedOut ? (
          <p className="type-body text-pretty text-muted-foreground">
            {contact.name.split(" ")[0]} has opted out. They never appear in
            reorder reminders or campaigns, and Sous cannot put them back — only
            they can ask to hear from you again.
          </p>
        ) : (
          <>
            <p className="type-body text-pretty text-muted-foreground">
              Reorder reminders and campaigns can include them. Ordering from
              you is what turned this on.
            </p>
            <div>
              <OptOutDialog name={contact.name} onOptOut={onOptOut} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
