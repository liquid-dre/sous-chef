"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomersScreen } from "@/components/customers/customers-screen";
import { ContactDetail } from "@/components/customers/contact-detail";
import { RepeatRing } from "@/components/customers/repeat-ring";
import type { ContactDetail as Detail, ContactRow, Reminder } from "@/components/customers/types";

/**
 * Customers specimen — the grading surface for this slice.
 *
 * The tab that matters is "Opted out". A permanent, irreversible consent flag
 * is the one thing on this screen that cannot be corrected later, so its
 * after-state has to read as settled rather than broken: no toggle, no
 * disabled switch, a sentence saying who can reverse it and that Sous cannot.
 */

const REMINDERS: Reminder[] = [
  {
    key: "o1:2026",
    orderId: "o1",
    customerId: "c1",
    customerName: "Andre Dingiswayo",
    phone: "+263715550184",
    occasion: "birthday",
    itemName: "Chocolate cake",
    lastOrderedOn: "2025-08-08",
    dueOn: "2026-08-08",
    daysAway: 3,
  },
  {
    key: "o2:2026",
    orderId: "o2",
    customerId: "c2",
    customerName: "Rudo Chikafu",
    phone: "+263772119003",
    occasion: "anniversary",
    itemName: "Celebration cake",
    lastOrderedOn: "2025-08-19",
    dueOn: "2026-08-19",
    daysAway: 14,
  },
];

const ROWS: ContactRow[] = [
  {
    id: "c1",
    name: "Andre Dingiswayo",
    phone: "+263715550184",
    email: "andre@example.com",
    marketingConsent: true,
    optedOut: false,
    orders: 11,
    lifetimeRevenueCents: 84_000,
    lifetimeProfitCents: 31_000,
    marginPercent: 37,
    lastOrderedOn: "2026-07-30",
  },
  {
    id: "c2",
    name: "Rudo Chikafu",
    phone: "+263772119003",
    email: null,
    marketingConsent: true,
    optedOut: false,
    orders: 4,
    lifetimeRevenueCents: 26_000,
    lifetimeProfitCents: 4_100,
    marginPercent: 16,
    lastOrderedOn: "2026-06-11",
  },
  {
    id: "c3",
    name: "Chipo Manyika",
    phone: "+263771234567",
    email: null,
    marketingConsent: false,
    optedOut: true,
    orders: 2,
    lifetimeRevenueCents: 9_000,
    lifetimeProfitCents: 2_200,
    marginPercent: 24,
    lastOrderedOn: "2026-02-04",
  },
];

const CONTACT: Detail = {
  ...ROWS[0],
  address: "14 Enterprise Road, Harare",
  notes: "Allergic to walnuts. Prefers collection.",
  history: [
    {
      orderId: "o1",
      deliveryDate: "2026-07-30",
      occasion: "birthday",
      revenueCents: 8_000,
      profitCents: 3_100,
      reason: null,
    },
    {
      orderId: "o9",
      deliveryDate: "2026-04-12",
      occasion: "corporate",
      revenueCents: 12_000,
      profitCents: 900,
      reason: "$4.00 discount + $3.00 more fuel than you charged",
    },
  ],
  occasions: [
    { occasion: "birthday", orders: 6, revenueCents: 48_000 },
    { occasion: "corporate", orders: 3, revenueCents: 24_000 },
  ],
  reminders: [REMINDERS[0]],
};

const STATES = {
  list: "The list, with two reminders",
  quiet: "Nothing to reach out about",
  empty: "A brand-new kitchen",
  contact: "One contact",
  optedOut: "Opted out",
} as const;

type StateKey = keyof typeof STATES;

export default function CustomersSpecimenPage() {
  const [key, setKey] = React.useState<StateKey>("list");
  const noop = async () => {};

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Customers specimen — sample data, nothing saves
        </p>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 md:w-auto">
          {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto,
              so without it the wrapper grows to its content and
              overflow-x-auto has nothing left to constrain. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Tabs value={key} onValueChange={(v) => setKey(v as StateKey)}>
              <TabsList>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="quiet">Quiet</TabsTrigger>
                <TabsTrigger value="empty">Empty</TabsTrigger>
                <TabsTrigger value="contact">Contact</TabsTrigger>
                <TabsTrigger value="optedOut">Opted out</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 md:px-6 md:py-12">
        <p className="type-caption text-pretty text-muted-foreground">
          {STATES[key]}. Only birthdays and anniversaries ever produce a
          reminder — a funeral never does, and that is hardcoded in
          convex/lib/contacts.ts rather than configured.
        </p>

        {key === "list" && (
          <CustomersScreen
            rows={ROWS}
            reminders={REMINDERS}
            optedOutCount={1}
            orgSlug="kitchen-a"
            onMessaged={() => {}}
            onDismiss={() => {}}
          />
        )}
        {key === "quiet" && (
          <CustomersScreen
            rows={ROWS}
            reminders={[]}
            optedOutCount={1}
            orgSlug="kitchen-a"
            onMessaged={() => {}}
            onDismiss={() => {}}
          />
        )}
        {key === "empty" && (
          <CustomersScreen
            rows={[]}
            reminders={[]}
            optedOutCount={0}
            orgSlug="kitchen-a"
            onMessaged={() => {}}
            onDismiss={() => {}}
          />
        )}
        {key === "contact" && (
          <ContactDetail
            contact={CONTACT}
            orgSlug="kitchen-a"
            onOptOut={noop}
            onSaveNotes={noop}
            onMessaged={() => {}}
            onDismiss={() => {}}
          />
        )}
        {key === "optedOut" && (
          <ContactDetail
            contact={{
              ...CONTACT,
              marketingConsent: false,
              optedOut: true,
              reminders: [],
            }}
            orgSlug="kitchen-a"
            onOptOut={noop}
            onSaveNotes={noop}
            onMessaged={() => {}}
            onDismiss={() => {}}
          />
        )}

        <section className="flex flex-col gap-4">
          <h2 className="type-display-sm">The ring, on its own</h2>
          <p className="type-caption text-pretty text-muted-foreground">
            One ring, not two segments — there is no pie in the vendored
            charts, and repeat-versus-first-time is a single proportion anyway.
            The centre is ours; the vendored RingCenter runs raw values through
            NumberFlow.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <RepeatRing
              periodLabel="This month"
              split={{
                repeatCents: 82_000,
                firstTimeCents: 41_000,
                repeatPercent: 67,
                repeatOrders: 9,
                firstTimeOrders: 4,
              }}
            />
            <RepeatRing
              periodLabel="This week"
              split={{
                repeatCents: 0,
                firstTimeCents: 0,
                repeatPercent: null,
                repeatOrders: 0,
                firstTimeOrders: 0,
              }}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
