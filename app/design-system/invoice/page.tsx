"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  InvoicePreview,
  type InvoicePreviewData,
} from "@/components/invoice/invoice-preview";
import { SAMPLE_INVOICE } from "@/components/invoice/sample-invoice";
import { InvoiceCard } from "@/components/orders/invoice-card";

/**
 * Invoice specimen — the grading surface for the customer-facing document.
 *
 * Every acceptance permutation is a tab: nothing set, everything set, a
 * walk-in, a deposit part-paid, a revision, a void, and a run long enough to
 * break across pages. The whole point of a single component is that these are
 * the same code path the PDF prints, so anything wrong here is wrong there.
 *
 * Note the mode toggle: switch the page to dark and the document stays ink on
 * paper, because `.invoice-paper` re-declares the light tokens for its own
 * subtree.
 */

const pause = () => new Promise<void>((r) => setTimeout(r, 400));

/** Everything off: no logo, no tax, no discount, no delivery, no deposit. */
const BARE: InvoicePreviewData = {
  ...SAMPLE_INVOICE,
  org: { name: "Rutendo's Kitchen", logoUrl: null, socials: [] },
  invoice: { prefix: "INV", number: 1, revision: 0 },
  customer: { name: "Tariro Moyo", phone: "+263 71 555 0184" },
  lines: [{ description: "Brownies", qtyMilli: 12_000, unitPriceCents: 300 }],
  deliveryFeeCents: 0,
  discountCents: 0,
  tax: { enabled: false, rateBp: 0, inclusive: false },
  depositPercent: null,
  payments: null,
  paymentInstructions: null,
  terms: null,
  zwgRateMilli: null,
};

/** Everything at once: logo, exclusive VAT, discount, delivery, ZWG, deposit. */
const LOADED: InvoicePreviewData = {
  ...SAMPLE_INVOICE,
  org: {
    ...SAMPLE_INVOICE.org,
    // An inline SVG data URI: no network, so the specimen renders identically
    // in the PDF, where an external image would race the capture.
    logoUrl:
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#2E6158"/><text x="24" y="31" font-family="Georgia,serif" font-size="20" fill="#F7F3EA" text-anchor="middle">RK</text></svg>`,
      ),
    socials: [
      { label: "@rutendoskitchen", url: "https://instagram.com/rutendoskitchen" },
      { label: "wa.me/263772345678", url: "https://wa.me/263772345678" },
    ],
  },
  invoice: { prefix: "RK", number: 128, revision: 0 },
  tax: { enabled: true, rateBp: 1550, inclusive: false },
  zwgRateMilli: 26_400,
  payments: { paidCents: 0, balanceCents: 0 },
};

/** Inclusive VAT — the caption path, not the added-row path. */
const INCLUSIVE: InvoicePreviewData = {
  ...LOADED,
  invoice: { prefix: "RK", number: 129, revision: 0 },
  tax: { enabled: true, rateBp: 1550, inclusive: true },
};

/** A counter sale: no customer, paid on the spot. */
const WALK_IN: InvoicePreviewData = {
  ...BARE,
  invoice: { prefix: "RK", number: 130, revision: 0 },
  customer: null,
  lines: [{ description: "Scones", qtyMilli: 4_000, unitPriceCents: 150 }],
  payments: { paidCents: 600, balanceCents: 0 },
  paymentInstructions: null,
};

/** Deposit taken, balance outstanding — the state the scope names. */
const PART_PAID: InvoicePreviewData = {
  ...SAMPLE_INVOICE,
  invoice: { prefix: "RK", number: 131, revision: 0 },
  lines: [{ description: "Two-tier wedding cake", qtyMilli: 1_000, unitPriceCents: 8_000 }],
  deliveryFeeCents: 0,
  discountCents: 0,
  payments: { paidCents: 4_000, balanceCents: 4_000 },
};

/** Overpaid, and said so rather than absorbed. */
const OVERPAID: InvoicePreviewData = {
  ...PART_PAID,
  invoice: { prefix: "RK", number: 132, revision: 0 },
  payments: { paidCents: 8_500, balanceCents: 0, excessCents: 500 },
};

/** Edited after it was sent. */
const REVISED: InvoicePreviewData = {
  ...LOADED,
  invoice: { prefix: "RK", number: 133, revision: 2 },
  payments: { paidCents: 2_000, balanceCents: 0 },
};

/** Void. Still a document; must not read as a live demand for money. */
const CANCELLED: InvoicePreviewData = {
  ...SAMPLE_INVOICE,
  invoice: { prefix: "RK", number: 134, revision: 1 },
  cancelled: true,
  payments: { paidCents: 0, balanceCents: 0 },
};

/** Long enough to break across pages — the break-inside rules. */
const LONG: InvoicePreviewData = {
  ...LOADED,
  invoice: { prefix: "RK", number: 135, revision: 0 },
  lines: Array.from({ length: 28 }, (_, i) => ({
    description: [
      "Brownies, salted caramel",
      "Chocolate fudge cake, 8 inch",
      "Lemon tartlets",
      "Sourdough loaf, seeded",
      "Scones, plain",
      "Carrot cake, cream cheese",
      "Milk tart",
    ][i % 7],
    qtyMilli: ((i % 5) + 1) * 1_000,
    unitPriceCents: 150 + i * 45,
  })),
};

const VIEWS = [
  { key: "bare", label: "Nothing set", data: BARE },
  { key: "loaded", label: "Everything", data: LOADED },
  { key: "inclusive", label: "Inclusive VAT", data: INCLUSIVE },
  { key: "walkin", label: "Walk-in", data: WALK_IN },
  { key: "part", label: "Part-paid", data: PART_PAID },
  { key: "over", label: "Overpaid", data: OVERPAID },
  { key: "revised", label: "Revised", data: REVISED },
  { key: "void", label: "Cancelled", data: CANCELLED },
  { key: "long", label: "Two pages", data: LONG },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"] | "card";

export default function InvoiceSpecimenPage() {
  const [view, setView] = React.useState<ViewKey>("loaded");
  const current = VIEWS.find((v) => v.key === view);

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Invoice specimen — the document stays light in dark mode
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="min-w-0 max-w-full overflow-x-auto">
            <Tabs value={view} onValueChange={(v) => setView(v as ViewKey)}>
              <TabsList>
                {VIEWS.map((v) => (
                  <TabsTrigger key={v.key} value={v.key}>
                    {v.label}
                  </TabsTrigger>
                ))}
                <TabsTrigger value="card">Her side</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-10">
        {view === "card" ? (
          <div className="flex flex-col gap-5">
            <InvoiceCard
              data={{
                invoiceLabel: null,
                invoiceToken: "i_specimen",
                revision: 0,
                sentAt: null,
                viewedAt: null,
                deliveryStatus: "notSent",
                customerPhone: "+263715550184",
                customerName: "Tariro Moyo",
                customerEmail: "tariro@example.co.zw",
                emailConfigured: true,
                orgName: "Rutendo's Kitchen",
              }}
              onIssue={pause}
              onSend={pause}
            />
            <InvoiceCard
              data={{
                invoiceLabel: "RK-0128",
                invoiceToken: "i_specimen",
                revision: 0,
                sentAt: Date.parse("2026-08-02T09:15:00Z"),
                viewedAt: null,
                deliveryStatus: "sent",
                customerPhone: "+263715550184",
                customerName: "Tariro Moyo",
                customerEmail: "tariro@example.co.zw",
                emailConfigured: true,
                orgName: "Rutendo's Kitchen",
              }}
              onIssue={pause}
              onSend={pause}
              onReplaceLink={pause}
              onEmail={async () => {
                await pause();
                return { ok: true, to: "tariro@example.co.zw" };
              }}
            />
            <InvoiceCard
              data={{
                invoiceLabel: "RK-0133",
                invoiceToken: "i_specimen",
                revision: 2,
                sentAt: Date.parse("2026-08-02T09:15:00Z"),
                viewedAt: Date.parse("2026-08-03T18:40:00Z"),
                deliveryStatus: "viewed",
                customerPhone: null,
                customerName: null,
                // No email address and no sending domain: the action is
                // absent, not greyed out.
                customerEmail: null,
                emailConfigured: false,
                orgName: "Rutendo's Kitchen",
              }}
              onIssue={pause}
              onSend={pause}
              onReplaceLink={pause}
              onEmail={async () => {
                await pause();
                return { ok: true, to: "tariro@example.co.zw" };
              }}
            />
            {/* The failure she must not miss. */}
            <InvoiceCard
              data={{
                invoiceLabel: "RK-0140",
                invoiceToken: "i_specimen",
                revision: 0,
                sentAt: null,
                viewedAt: null,
                deliveryStatus: "notSent",
                customerPhone: "+263715550184",
                customerName: "Rudo Chikafu",
                customerEmail: "rudo@example.co.zw",
                emailConfigured: true,
                orgName: "Rutendo's Kitchen",
              }}
              onIssue={pause}
              onSend={pause}
              onReplaceLink={pause}
              onEmail={async () => {
                await pause();
                return {
                  ok: false,
                  message:
                    "Couldn't send it: the address was rejected. Nothing was sent.",
                };
              }}
            />
          </div>
        ) : (
          <div className="invoice-paper">
            <InvoicePreview data={current!.data} />
          </div>
        )}
      </main>
    </div>
  );
}
