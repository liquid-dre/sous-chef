"use client";

import { Money } from "@/components/numeric/money";
import { cn } from "@/lib/utils";
import type { InvoiceTotals } from "@/lib/invoice-totals";
import { Button } from "@/components/ui/button";
import { CancelOrderDialog } from "./cancel-order-dialog";
import { InvoiceCard, type EmailResult } from "./invoice-card";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { RemovePaymentDialog } from "./remove-payment-dialog";

/**
 * Where saving lands. Read-only on purpose: the order is written, the costs
 * are snapshotted, and the next thing she does is get on with her day.
 *
 * The costing block is absent entirely for staff — not hidden with CSS. It
 * arrives as null from the server.
 */

export interface SavedOrderData {
  order: {
    id: string;
    /** Null until a document is actually issued. */
    invoiceNumber: number | null;
    invoicePrefix: string;
    /** "INV-0042", or null while unissued. Built server-side so the label is
     * formatted in one place. */
    invoiceLabel: string | null;
    invoiceToken: string;
    revision: number;
    sentAt: number | null;
    viewedAt: number | null;
    deliveryStatus: "notSent" | "sent" | "viewed";
    status: "confirmed" | "delivered" | "cancelled";
    cancellationReason: string | null;
    orderDate: string;
    deliveryDate: string;
    occasion: string | null;
  };
  customer: { name: string; phone: string; email?: string | null } | null;
  invoiceOrg?: { name: string };
  /** False when the kitchen has no sending domain connected. */
  emailConfigured?: boolean;
  lines: {
    id: string;
    description: string;
    qtyMilli: number;
    lineTotalCents: number;
    uncosted: boolean;
  }[];
  totals: InvoiceTotals;
  payments: {
    paidCents: number;
    balanceCents: number;
    /** Paid beyond the total. Its own fact, never a fourth status. */
    excessCents: number;
    status: "unpaid" | "partPaid" | "paid";
    rows: {
      id: string;
      amountCents: number;
      paidAt: number;
      method: string | null;
      canRemove: boolean;
    }[];
    depositShown: boolean;
    depositCents: number;
  };
  costing: {
    grossMarginPercent: number | null;
    netMarginPercent: number | null;
    leavesYouCents: number;
    uncostedGoodsCents: number;
    overheadRateSet: boolean;
    deliveryCostMissing: boolean;
  } | null;
}

function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function SavedOrderView({
  data,
  batchesMade = 0,
  onCancelOrder,
  onRecordPayment,
  onRemovePayment,
  onIssueInvoice,
  onSendInvoice,
  onReplaceLink,
  onEmailInvoice,
}: {
  data: SavedOrderData;
  batchesMade?: number;
  onCancelOrder?: (reason: string) => Promise<void>;
  onRecordPayment?: (amountCents: number, method: string) => Promise<void>;
  onRemovePayment?: (paymentId: string) => Promise<void>;
  onIssueInvoice?: () => Promise<void>;
  onSendInvoice?: () => Promise<void>;
  onReplaceLink?: () => Promise<void>;
  onEmailInvoice?: () => Promise<EmailResult>;
}) {
  const { order, customer, lines, totals, payments, costing } = data;
  const cancelled = order.status === "cancelled";
  // The person, not the paperwork. Before an invoice is issued there is no
  // number to title this with, and the name is what she recognises anyway.
  const who = customer?.name ?? "Counter sale";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="type-display-sm">{who}</h1>
          <p className="type-body text-muted-foreground">
            {order.invoiceLabel ? `${order.invoiceLabel} · ` : ""}
            deliver {formatDay(order.deliveryDate)}
          </p>
        </div>
        {cancelled && (
          <span className="rounded-full bg-loss-soft px-3 py-1 type-label text-loss-foreground">
            Cancelled
          </span>
        )}
      </header>

      {cancelled && order.cancellationReason && (
        <p className="type-body rounded-md bg-muted p-3 text-muted-foreground">
          &ldquo;{order.cancellationReason}&rdquo;
        </p>
      )}

      <section
        aria-label="Order lines"
        className="flex flex-col gap-2 rounded-lg border bg-card p-4 md:p-5"
      >
        <ul className="flex flex-col divide-y">
          {lines.map((line) => (
            <li key={line.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="type-body block truncate">{line.description}</span>
                {line.uncosted && (
                  <span className="type-caption block text-muted-foreground">
                    off-menu
                  </span>
                )}
              </span>
              <span className="numeric-sm shrink-0 text-muted-foreground">
                ×{line.qtyMilli / 1000}
              </span>
              <span className="numeric-sm w-20 shrink-0 text-right">
                <Money amount={line.lineTotalCents / 100} size="sm" />
              </span>
            </li>
          ))}
        </ul>

        <dl className="flex flex-col gap-1 border-t pt-3">
          {totals.discountCents > 0 && (
            <TotalRow label="Less" cents={-totals.discountCents} />
          )}
          {totals.deliveryFeeCents > 0 && (
            <TotalRow label="Delivery" cents={totals.deliveryFeeCents} />
          )}
          {totals.taxAddedCents > 0 && (
            <TotalRow label="Tax" cents={totals.taxAddedCents} />
          )}
          <div className="flex items-baseline justify-between gap-3 border-t pt-2">
            <dt className="type-label">Total</dt>
            <dd className="numeric-lg">
              <Money amount={totals.totalCents / 100} size="lg" />
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-label="Payments"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="type-title">
            {payments.status === "paid"
              ? "Paid"
              : payments.status === "partPaid"
                ? "Part-paid"
                : "Unpaid"}
          </h2>
          {payments.balanceCents > 0 && (
            <span className="type-caption text-muted-foreground">
              <Money amount={payments.balanceCents / 100} size="sm" />{" "}
              outstanding
            </span>
          )}
        </div>

        {/* The excess is its own fact, never a fourth status — the order IS
            paid, and the credit is about her relationship with the customer. */}
        {payments.excessCents > 0 && (
          <p className="type-caption text-muted-foreground">
            <Money amount={payments.excessCents / 100} size="sm" /> more than
            the total. Nothing was blocked.
          </p>
        )}

        {payments.rows.length > 0 && (
          <ul className="flex flex-col divide-y">
            {payments.rows.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="numeric-body block">
                    <Money amount={p.amountCents / 100} size="body" />
                  </span>
                  <span className="type-caption block text-muted-foreground">
                    {new Date(p.paidAt).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                    })}
                    {p.method ? ` · ${p.method}` : ""}
                  </span>
                </span>
                {p.canRemove && onRemovePayment && (
                  <RemovePaymentDialog
                    amountCents={p.amountCents}
                    paidAt={p.paidAt}
                    onRemove={() => onRemovePayment(p.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {order.status !== "cancelled" && onRecordPayment && (
          <div className="flex flex-wrap items-center gap-2">
            {payments.balanceCents > 0 && (
              <Button
                size="sm"
                onClick={() => onRecordPayment(payments.balanceCents, "")}
              >
                Paid in full
              </Button>
            )}
            {payments.depositShown && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRecordPayment(payments.depositCents, "")}
              >
                Deposit <Money amount={payments.depositCents / 100} size="sm" />
              </Button>
            )}
            <RecordPaymentDialog
              balanceCents={payments.balanceCents}
              onRecord={onRecordPayment}
              trigger={
                <Button variant="ghost" size="sm">
                  Another amount
                </Button>
              }
            />
          </div>
        )}
      </section>

      {costing && (
        <section
          aria-label="What it leaves you"
          className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5"
        >
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="type-caption text-muted-foreground">Gross</dt>
              <dd className={cn("numeric-lg", (costing.grossMarginPercent ?? 0) < 0 && "text-loss")}>
                {costing.grossMarginPercent == null ? "—" : `${costing.grossMarginPercent}%`}
              </dd>
            </div>
            <div>
              <dt className="type-caption text-muted-foreground">Net</dt>
              <dd className={cn("numeric-lg", (costing.netMarginPercent ?? 0) < 0 && "text-loss")}>
                {costing.netMarginPercent == null ? "—" : `${costing.netMarginPercent}%`}
              </dd>
            </div>
            <div>
              <dt className="type-caption text-muted-foreground">Leaves you</dt>
              <dd className="numeric-lg">
                <Money amount={costing.leavesYouCents / 100} size="lg" />
              </dd>
            </div>
          </dl>

          {costing.deliveryCostMissing && (
            <p className="type-caption text-warn-foreground">
              You charged for delivery but recorded no fuel against it, so this
              reads better than it was.
            </p>
          )}
          {!costing.overheadRateSet && (
            <p className="type-caption text-warn-foreground">
              Your hourly rate isn&rsquo;t set, so your time is counted as free
              and net margin is flattering you.
            </p>
          )}
          {costing.uncostedGoodsCents > 0 && (
            <p className="type-caption text-muted-foreground">
              <Money amount={costing.uncostedGoodsCents / 100} size="sm" /> of
              this is off-menu, so it sits outside these figures.
            </p>
          )}
        </section>
      )}

      {!cancelled && (
        <InvoiceCard
          data={{
            invoiceLabel: order.invoiceLabel,
            invoiceToken: order.invoiceToken,
            revision: order.revision,
            sentAt: order.sentAt,
            viewedAt: order.viewedAt,
            deliveryStatus: order.deliveryStatus,
            customerPhone: customer?.phone ?? null,
            customerName: customer?.name ?? null,
            customerEmail: customer?.email ?? null,
            emailConfigured: data.emailConfigured ?? false,
            orgName: data.invoiceOrg?.name ?? "your kitchen",
          }}
          onIssue={onIssueInvoice}
          onSend={onSendInvoice}
          onReplaceLink={onReplaceLink}
          onEmail={onEmailInvoice}
        />
      )}

      {onCancelOrder && !cancelled && order.status !== "delivered" && (
        <div className="flex justify-end">
          <CancelOrderDialog
            invoiceLabel={order.invoiceLabel ?? who}
            batchesMade={batchesMade}
            onCancelOrder={onCancelOrder}
          />
        </div>
      )}
    </div>
  );
}

function TotalRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="type-body text-muted-foreground">{label}</dt>
      <dd className="numeric-sm">
        <Money amount={cents / 100} size="sm" />
      </dd>
    </div>
  );
}
