import type { ReactNode } from "react";
import { Money, formatMoney } from "@/components/numeric/money";
import { cn } from "@/lib/utils";
import {
  computeInvoiceTotals,
  lineTotalCents,
  type InvoiceLine,
  type InvoiceTotals,
  type InvoiceTotalsInput,
} from "@/lib/invoice-totals";

// The arithmetic moved to lib/ so the order screen and the save mutation
// share this exact implementation; re-exported here because this module is
// still where callers (and invoice-totals.test.ts) expect to find it.
export { computeInvoiceTotals, lineTotalCents };
export type { InvoiceLine, InvoiceTotals };

/**
 * THE invoice. One presentational component for the Settings live preview,
 * the screen render, and (3.1) the server-side PDF — what she screenshots is
 * pixel-identical to what emails out. It takes one fully-formed props object
 * and NOTHING else: no Convex, no hooks, no data fetching (enforced by
 * convex/enforcement.test.ts). Colours come from the theme tokens in scope,
 * so it automatically wears the org palette wherever it renders.
 *
 * All arithmetic in integer cents. Quantities arrive as qtyMilli
 * (thousandths of a unit) per the schema's uniform rule.
 */

export interface InvoicePreviewData extends InvoiceTotalsInput {
  org: {
    name: string;
    logoUrl?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    socials?: { label: string; url: string }[];
  };
  invoice: {
    prefix: string;
    number: number;
    /** Printed once an edit follows the send. 0 = never sent/edited. */
    revision: number;
  };
  /** Null for a walk-in. A market-stall sale has no customer row — and a
   * printed "Walk-in" would assert a person to their face. The block is
   * omitted instead. */
  customer: { name: string; phone: string; address?: string | null } | null;
  /** Domain days, "YYYY-MM-DD". */
  orderDate: string;
  deliveryDate: string;
  /** What has actually been received against it. Balance due is the one
   * figure this document exists to communicate. */
  payments?: {
    paidCents: number;
    balanceCents: number;
    /** Paid beyond the total. Surfaced, never silently absorbed. */
    excessCents?: number;
  } | null;
  /** A void invoice is still a document, and must not read as a live demand
   * for money. */
  cancelled?: boolean;
  paymentInstructions?: string | null;
  terms?: string | null;
  /** ZWG per USD ×1000. A render, never a conversion (CONTEXT.md — Money). */
  zwgRateMilli?: number | null;
}

function formatQty(qtyMilli: number): string {
  const qty = qtyMilli / 1000;
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(qty * 10 % 1 === 0 ? 1 : 2);
}

function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatZwg(cents: number): string {
  return `ZWG ${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function TotalRow({
  label,
  cents,
  negative,
  emphasis,
  credit,
}: {
  label: ReactNode;
  cents: number;
  negative?: boolean;
  emphasis?: boolean;
  /** Money IN, shown as a deduction. See the note below. */
  credit?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className={cn(emphasis ? "type-label" : "type-caption text-muted-foreground")}>
        {label}
      </span>
      <Money
        amount={(negative ? -cents : cents) / 100}
        size={emphasis ? "lg" : "sm"}
        // Money paints anything below zero in --loss. Correct for a loss;
        // wrong for a payment received. DESIGN.md's red-and-parenthesised rule
        // governs NEGATIVE MONEY — and $40 the customer has already handed
        // over is positive money being subtracted from a balance. It keeps the
        // parentheses, because a deduction has to be unmistakable, and drops
        // the colour, because telling a customer their payment was a loss is
        // the wrong sentence on the one document they read closely.
        className={credit ? "text-foreground" : undefined}
      />
    </div>
  );
}

export function InvoicePreview({
  data,
  className,
}: {
  data: InvoicePreviewData;
  className?: string;
}) {
  const totals = computeInvoiceTotals(data);
  const paidCents = data.payments?.paidCents ?? 0;
  // Derived here rather than trusted from the caller, so the preview in
  // Settings — which has no payment ledger behind it — stays consistent with
  // the real thing instead of needing a second code path.
  const balanceCents = Math.max(0, totals.totalCents - paidCents);
  const excessCents = data.payments?.excessCents ?? Math.max(0, paidCents - totals.totalCents);
  // A $0 order is not "paid in full" the moment it is created — that would
  // stamp a tasting sample as settled before anyone looked at it.
  const settled = paidCents > 0 && balanceCents === 0;
  const number = `${data.invoice.prefix}-${String(data.invoice.number).padStart(4, "0")}`;
  const ratePercent = data.tax.rateBp / 100;
  const rateLabel = Number.isInteger(ratePercent)
    ? `${ratePercent}%`
    : `${ratePercent.toFixed(1)}%`;

  return (
    <article
      aria-label={`Invoice ${number} preview`}
      className={cn("flex flex-col gap-6 rounded-lg border bg-card p-6 md:p-8", className)}
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="type-display-sm break-words">{data.org.name}</p>
          <div className="type-caption mt-1 flex flex-col gap-0.5 text-muted-foreground">
            {data.org.address && <span>{data.org.address}</span>}
            <span>
              {[data.org.phone, data.org.email].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {data.org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URLs and storage URLs; print context
            <img
              src={data.org.logoUrl}
              alt=""
              className="size-12 rounded-md border object-cover"
            />
          ) : null}
          <p className="type-label text-muted-foreground">Invoice</p>
          <p className="numeric-body">{number}</p>
          {data.invoice.revision > 0 && (
            <p className="type-caption text-muted-foreground">
              Revision {data.invoice.revision}
            </p>
          )}
        </div>
      </header>

      <div className="h-px bg-primary/60" aria-hidden />

      {data.cancelled && (
        <p
          className="type-label rounded-md border border-loss/40 bg-loss-soft px-3 py-2 text-loss-foreground"
          role="status"
        >
          Cancelled — this invoice is void and nothing is owed on it.
        </p>
      )}

      {/* Parties + dates. A walk-in has no left column, so the dates take the
          whole row rather than sitting beside an empty half. */}
      <div
        className={cn(
          "grid gap-4",
          data.customer ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {data.customer && (
          <div className="min-w-0">
            <p className="type-caption text-muted-foreground">Billed to</p>
            <p className="type-body mt-0.5 font-medium break-words">
              {data.customer.name}
            </p>
            <p className="numeric-sm text-muted-foreground">{data.customer.phone}</p>
            {data.customer.address && (
              <p className="type-caption text-muted-foreground">{data.customer.address}</p>
            )}
          </div>
        )}
        <div className="flex flex-col items-end gap-1 text-right">
          <div>
            <p className="type-caption text-muted-foreground">Order date</p>
            <p className="numeric-sm">{formatDay(data.orderDate)}</p>
          </div>
          <div>
            <p className="type-caption text-muted-foreground">Delivery</p>
            <p className="numeric-sm">{formatDay(data.deliveryDate)}</p>
          </div>
        </div>
      </div>

      {/* Lines */}
      <div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b pb-1.5 md:grid-cols-[1fr_auto_auto_auto]">
          <span className="type-caption text-muted-foreground">Item</span>
          <span className="type-caption text-right text-muted-foreground">Qty</span>
          <span className="type-caption hidden text-right text-muted-foreground md:block">
            Unit
          </span>
          <span className="type-caption text-right text-muted-foreground">Amount</span>
        </div>
        <ul className="flex flex-col">
          {data.lines.map((line, i) => (
            <li
              key={i}
              // break-inside-avoid: a long order runs to a second page, and a
              // line item split across the fold is the sort of thing a
              // customer queries.
              className="grid break-inside-avoid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 border-b border-border/60 py-2 md:grid-cols-[1fr_auto_auto_auto]"
            >
              <span className="type-body min-w-0 break-words">{line.description}</span>
              <span className="numeric-sm text-right">{formatQty(line.qtyMilli)}</span>
              <span className="numeric-sm hidden text-right text-muted-foreground md:block">
                {formatMoney(line.unitPriceCents / 100)}
              </span>
              <span className="numeric-body text-right">
                {formatMoney(lineTotalCents(line) / 100)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Totals.
          The ladder is deliberately quiet and the BALANCE is the terminal
          figure: this document's whole job is to answer "how much do I still
          owe", and it is read as a compressed WhatsApp screenshot on a phone.
          So the supporting rows stay at caption weight, the total is a label,
          and what is actually due gets numeric-xl inside a tinted block —
          the one place the palette is spent down here, per DESIGN.md's "a
          rule, a heading, a total". */}
      <div className="ml-auto flex w-full max-w-72 break-inside-avoid flex-col gap-1.5">
        <TotalRow label="Subtotal" cents={totals.subtotalCents} />
        {totals.discountCents > 0 && (
          <TotalRow label="Discount" cents={totals.discountCents} negative />
        )}
        {totals.deliveryFeeCents > 0 && (
          <TotalRow label="Delivery" cents={totals.deliveryFeeCents} />
        )}
        {totals.taxAddedCents > 0 && (
          <TotalRow
            label={
              <>
                VAT <span className="numeric">{rateLabel}</span>
              </>
            }
            cents={totals.taxAddedCents}
          />
        )}
        <div className="my-1 h-px bg-border" aria-hidden />
        <TotalRow label="Total" cents={totals.totalCents} emphasis />
        {paidCents > 0 && (
          <TotalRow label="Paid" cents={paidCents} negative emphasis credit />
        )}

        {/* What is actually due. */}
        {!data.cancelled &&
          (settled ? (
            <div className="mt-2 flex items-baseline justify-between gap-4 rounded-md border border-profit/35 bg-profit-soft px-4 py-3">
              <span className="type-label text-profit-foreground">Paid in full</span>
              <span className="numeric-lg text-profit-foreground">
                {formatMoney(paidCents / 100)}
              </span>
            </div>
          ) : (
            <div className="mt-2 flex items-baseline justify-between gap-4 rounded-md border border-primary/30 bg-primary-soft px-4 py-3">
              <span className="type-label">Balance due</span>
              <span className="numeric-xl">
                {formatMoney(balanceCents / 100)}
              </span>
            </div>
          ))}
        {excessCents > 0 && (
          // Surfaced, never absorbed: she owes this back, and the customer
          // should see that Sous knows it.
          <p className="type-caption text-right text-muted-foreground">
            Overpaid by{" "}
            <span className="numeric">{formatMoney(excessCents / 100)}</span>
          </p>
        )}

        {/* Money never renders in the proportional face, captions included. */}
        {totals.taxIncludedCents > 0 && (
          <p className="type-caption text-right text-muted-foreground">
            Includes VAT <span className="numeric">{rateLabel}</span> ·{" "}
            <span className="numeric">{formatMoney(totals.taxIncludedCents / 100)}</span>
          </p>
        )}
        {data.zwgRateMilli ? (
          <p className="type-caption text-right text-muted-foreground">
            ≈{" "}
            <span className="numeric">
              {formatZwg(Math.round((balanceCents || totals.totalCents) * data.zwgRateMilli / 1000))}
            </span>{" "}
            at the rate on this invoice
          </p>
        ) : null}
        {/* Only while nothing has been paid — once a deposit lands, the
            balance above is the live number and a deposit line competes
            with it. */}
        {totals.depositCents > 0 && paidCents === 0 && !data.cancelled && (
          <p className="type-caption text-right text-muted-foreground">
            Deposit to confirm:{" "}
            <span className="numeric">{formatMoney(totals.depositCents / 100)}</span>
          </p>
        )}
      </div>

      {/* Payment instructions — in Zimbabwe, the most-used field on the page.
          Suppressed on a void invoice: telling someone how to pay a bill that
          has been cancelled is how a kitchen gets paid twice and has to give
          it back. */}
      {data.paymentInstructions && !data.cancelled && (
        <div className="rounded-md bg-muted/60 p-4">
          <p className="type-label">How to pay</p>
          <p className="type-body mt-1 whitespace-pre-line">{data.paymentInstructions}</p>
        </div>
      )}

      <footer className="flex flex-col gap-3">
        {data.terms && (
          <p className="type-caption whitespace-pre-line text-muted-foreground">{data.terms}</p>
        )}
        <div className="flex items-end justify-between gap-4">
          <p className="type-caption text-muted-foreground">
            {(data.org.socials ?? []).map((s) => s.label).join(" · ")}
          </p>
          <p className="type-flourish text-primary" aria-hidden>
            thank you
          </p>
        </div>
      </footer>
    </article>
  );
}
