"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessagesScreen } from "@/components/messages/messages-screen";
import { RecipientPanel } from "@/components/messages/recipient-panel";
import { TemplateEditor } from "@/components/messages/template-editor";
import { CampaignForm } from "@/components/messages/campaign-form";
import type {
  OutboxData,
  PreviewData,
  QueueRow,
  Reminder,
  ScheduleRow,
} from "@/components/messages/types";

/**
 * Messages specimen — the grading surface for this slice.
 *
 * The tab that matters is "Mid-batch". Twelve of twenty done, one row opened
 * and waiting on her answer, eight untouched — the state a phone call, an
 * oven timer or a reload drops her into, and the one the whole feature exists
 * to survive. On the real route it comes back from the server; here it is
 * mounted directly, which is the point of keeping `MessagesScreen` free of
 * Convex.
 *
 * The other one worth looking at is "Excluded". The reasons a person is not
 * getting a message are the substance of that panel rather than a footnote:
 * two of the three she can fix in a minute, and the third has a statute
 * behind it and says so.
 */

const NAMES = [
  "Andre Dingiswayo",
  "Rudo Chikafu",
  "Tendai Moyo",
  "Grace Nyathi",
  "Farai Zhou",
  "Chipo Banda",
  "Tafadzwa Mhuka",
  "Nyasha Dube",
];

const BODY = (name: string) =>
  `Hi ${name.split(" ")[0]}, taking orders for Wednesday. Same as last time?`;

function queueRow(i: number, over: Partial<QueueRow> = {}): QueueRow {
  const name = NAMES[i % NAMES.length];
  return {
    id: `row_${i}`,
    campaignId: null,
    channel: "whatsapp",
    body: BODY(name),
    customerId: `c${i}`,
    customerName: name,
    phone: `+26371555018${i}`,
    email: null,
    opened: false,
    openedAt: null,
    ...over,
  };
}

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
];

const SCHEDULES: ScheduleRow[] = [
  {
    id: "s1",
    templateId: "t1",
    templateName: "Sunday order call",
    weekday: 0,
    active: true,
    dueToday: true,
  },
];

const MID_BATCH: OutboxData = {
  today: "2026-08-09",
  // One opened and waiting on her answer, then seven untouched.
  queue: [
    queueRow(0, { opened: true, openedAt: 1_770_000_000_000 }),
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => queueRow(i)),
  ],
  dueDrafts: [],
  reminders: [],
  doneToday: 12,
};

const DUE: OutboxData = {
  today: "2026-08-09",
  queue: [],
  dueDrafts: [
    {
      scheduleId: "s1",
      key: "s1:2026-08-09",
      templateId: "t1",
      templateName: "Sunday order call",
      channel: "whatsapp",
      body: "Hi {name}, taking orders for Wednesday. Same as last time?",
      subject: null,
    },
  ],
  reminders: REMINDERS,
  doneToday: 0,
};

const EMAIL_BATCH: OutboxData = {
  today: "2026-08-09",
  queue: [
    queueRow(0, { channel: "email", email: "andre@example.com" }),
    // No address on file: the row says what to do about it rather than
    // offering a button that cannot work.
    queueRow(1, { channel: "email", email: null }),
  ],
  dueDrafts: [],
  reminders: [],
  doneToday: 3,
};

const EMPTY: OutboxData = {
  today: "2026-08-09",
  queue: [],
  dueDrafts: [],
  reminders: [],
  doneToday: 0,
};

const PREVIEW: PreviewData = {
  tokens: ["name", "item"],
  contacts: NAMES.map((name, i) => ({ id: `c${i}`, name })),
  previewFor: { id: "c0", name: "Andre Dingiswayo" },
  previewText:
    "Hi Andre, taking orders for Wednesday. Chocolate cake again?",
  previewExcluded: null,
  sendingCount: 31,
  totalCount: 40,
  exclusions: [
    { label: "opted out of marketing", names: ["Rudo Chikafu", "Tendai Moyo"] },
    {
      label: "no past order to fill {item}",
      names: ["Grace Nyathi", "Farai Zhou", "Chipo Banda", "Nyasha Dube", "Tafadzwa Mhuka", "Kudzai Sibanda"],
    },
    { label: "no WhatsApp number", names: ["Rutendo Ncube"] },
  ],
};

const STATES = {
  midBatch: "Mid-batch — twelve done, one waiting on her answer",
  due: "Sunday morning: a draft due, a birthday coming",
  email: "An email batch",
  excluded: "Who is excluded, and why",
  editor: "Writing a template",
  campaign: "A campaign",
  empty: "Nothing waiting",
} as const;

type StateKey = keyof typeof STATES;

export default function MessagesSpecimenPage() {
  const [key, setKey] = React.useState<StateKey>("midBatch");
  const [draft, setDraft] = React.useState({
    name: "Sunday order call",
    channel: "whatsapp" as "whatsapp" | "email",
    body: "Hi {name}, taking orders for Wednesday. {item} again?",
    subject: null as string | null,
  });
  const [campaign, setCampaign] = React.useState({
    name: "August menu",
    channel: "whatsapp" as "whatsapp" | "email",
    subject: "",
    body: "Hi {name}, the August menu is out. Orders close Thursday.",
  });

  const noop = () => {};
  const data =
    key === "due"
      ? DUE
      : key === "email"
        ? EMAIL_BATCH
        : key === "empty"
          ? EMPTY
          : MID_BATCH;

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Messages specimen — sample data, nothing sends
        </p>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 md:w-auto">
          {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto,
              so without it the wrapper grows to its content and
              overflow-x-auto has nothing left to constrain. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Tabs value={key} onValueChange={(v) => setKey(v as StateKey)}>
              <TabsList>
                <TabsTrigger value="midBatch">Mid-batch</TabsTrigger>
                <TabsTrigger value="due">Due</TabsTrigger>
                <TabsTrigger value="email">Email</TabsTrigger>
                <TabsTrigger value="excluded">Excluded</TabsTrigger>
                <TabsTrigger value="editor">Editor</TabsTrigger>
                <TabsTrigger value="campaign">Campaign</TabsTrigger>
                <TabsTrigger value="empty">Empty</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 md:px-6 md:py-12">
        <p className="type-caption text-pretty text-muted-foreground">
          {STATES[key]}. Nothing here sends by itself, on this page or on the
          real route — every row is a draft with her name on it, and each one
          waits for a tap.
        </p>

        {(key === "midBatch" ||
          key === "due" ||
          key === "email" ||
          key === "empty") && (
          <MessagesScreen
            data={data}
            schedules={key === "empty" ? [] : SCHEDULES}
            orgSlug="kitchen-a"
            inFlight={new Set()}
            errors={
              key === "email"
                ? new Map([["row_0", "That address bounced. Nothing was sent."]])
                : new Map()
            }
            emailConfigured
            onOpen={noop}
            onSent={noop}
            onSkip={noop}
            onSendEmail={noop}
            onStartDraft={noop}
            onDismissDraft={noop}
            onMessageReminder={noop}
          />
        )}

        {key === "excluded" && (
          <section className="flex flex-col gap-4">
            <h2 className="type-display-sm">Nine people are not getting this</h2>
            <p className="type-caption text-pretty text-muted-foreground">
              Two of these three she can fix in a minute — add a number, or
              reword the template so it stops asking for an item six people
              have never bought. The third cannot be fixed by anyone, and it is
              stated in those terms so it never reads as a bug.
            </p>
            <RecipientPanel preview={PREVIEW} />
          </section>
        )}

        {key === "editor" && (
          <TemplateEditor
            draft={draft}
            preview={PREVIEW}
            contacts={PREVIEW.contacts}
            previewContactId="c0"
            saving={false}
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
            onPreviewContact={() => {}}
            onCancel={() => {}}
            onSave={async () => {}}
          />
        )}

        {key === "campaign" && (
          <CampaignForm
            draft={campaign}
            preview={PREVIEW}
            file={null}
            uploading={false}
            saving={false}
            error={null}
            emailConfigured
            onChange={(next) => setCampaign((c) => ({ ...c, ...next }))}
            onFile={() => {}}
            onCancel={() => {}}
            onCreate={() => {}}
          />
        )}
      </main>
    </div>
  );
}
