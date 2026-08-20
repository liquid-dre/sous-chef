"use client";

import * as React from "react";
import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/numeric/money";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/day";
import { FeedbackSheet } from "@/components/feedback/feedback-sheet";
import type { FeedbackFlag, SensoryAxis } from "@/convex/lib/feedback";

/**
 * The orders screen: one list, three readings.
 *
 * Upcoming is the bake list, Owing is the chase list, All is the archive.
 * "Who owes me" is a filter rather than a screen because it genuinely is a
 * query — the same rows, a different question — and because the nav has no
 * room for it.
 *
 * The two buttons on an owing row are the whole point: full payment is one
 * tap, and the deposit is one more. Any other amount opens the order, where
 * a keyboard is appropriate.
 */

export type OrdersFilter = "upcoming" | "owing" | "all";

export interface OrderRow {
  id: string;
  /** Null until a document has been issued for it — most orders, most of the
   * time, and every counter sale. */
  invoiceNumber: number | null;
  /** "INV-0042" or null. Built server-side, in one place. */
  invoiceLabel: string | null;
  customerName: string;
  isWalkIn: boolean;
  orderDate: string;
  deliveryDate: string;
  status: "confirmed" | "delivered" | "cancelled";
  paymentStatus: "unpaid" | "partPaid" | "paid";
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  excessCents: number;
  source: "app" | "quickSale";
  /** Derived from sentAt/viewedAt server-side. */
  deliveryStatus: "notSent" | "sent" | "viewed";
  ageDays: number | null;
  depositShown: boolean;
  depositCents: number;
  /** What the one-tap feedback sheet asks about. Empty when nothing on this
   * order has axes set up — the sheet still takes flags and her own words. */
  feedbackItems: { menuItemId: string; name: string; axes: SensoryAxis[] }[];
  feedbackCount: number;
  customerReplied: boolean;
}

const FILTERS: { value: OrdersFilter; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "owing", label: "Owing" },
  { value: "all", label: "All" },
];

const PAYMENT_LABEL: Record<OrderRow["paymentStatus"], string> = {
  unpaid: "Unpaid",
  partPaid: "Part-paid",
  paid: "Paid",
};

export function OrdersList({
  orgSlug,
  filter,
  onFilterChange,
  rows,
  owedCents,
  owingCount,
  busyId,
  justPaid,
  onRecordFull,
  onRecordDeposit,
  onUndoPayment,
  onLogFeedback,
}: {
  orgSlug: string;
  filter: OrdersFilter;
  onFilterChange: (f: OrdersFilter) => void;
  rows: OrderRow[];
  owedCents: number;
  owingCount: number;
  busyId?: string | null;
  /** The payment just taken on this screen, so a mis-tap is one tap back. */
  justPaid?: { rowId: string; paymentId: string; amountCents: number } | null;
  onRecordFull?: (row: OrderRow) => void;
  onRecordDeposit?: (row: OrderRow) => void;
  onUndoPayment?: (paymentId: string) => void;
  onLogFeedback?: (
    row: OrderRow,
    input: {
      menuItemId?: string;
      axisRatings: { axis: SensoryAxis; value: number }[];
      flags: FeedbackFlag[];
      freeText?: string;
    },
  ) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-display-sm">Orders</h1>
        {owingCount > 0 && (
          <p className="type-caption text-muted-foreground">
            <span className="numeric">
              <Money amount={owedCents / 100} size="sm" />
            </span>{" "}
            owed to you across {owingCount}{" "}
            {owingCount === 1 ? "order" : "orders"}
          </p>
        )}
      </div>

      <div
        className="flex min-w-0 gap-1 overflow-x-auto"
        role="group"
        aria-label="Which orders"
      >
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => onFilterChange(f.value)}
            className={cn(
              "min-h-11 shrink-0 rounded-full border px-4 type-label outline-none transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-9",
              filter === f.value
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title={
            filter === "owing"
              ? "Nobody owes you anything"
              : filter === "upcoming"
                ? "Nothing to bake"
                : "No orders yet"
          }
          body={
            filter === "owing"
              ? "Every order that has been delivered has been paid for."
              : filter === "upcoming"
                ? "Nothing is booked in. Orders you take will show up here."
                : "The first order you log will land here."
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {rows.map((row) => {
            const busy = busyId === row.id;
            return (
              <li key={row.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/${orgSlug}/orders/${row.id}`}
                    // Two lines of text come to 38px, which is under the
                    // thumb minimum — and this is the way into the order.
                    className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9"
                  >
                    <span className="type-body block truncate">
                      {row.customerName}
                    </span>
                    <span className="type-caption block text-muted-foreground">
                      {/* Omitted entirely rather than shown as a placeholder:
                           an order with no document has no number, and
                           "INV-—" would read as one that went missing. */}
                      {row.invoiceLabel ? `${row.invoiceLabel} · ` : ""}
                      {formatDay(row.deliveryDate)}
                      {row.ageDays != null && row.balanceCents > 0 && (
                        <>
                          {" · "}
                          <span className="numeric">{row.ageDays}</span>{" "}
                          {row.ageDays === 1 ? "day" : "days"} ago
                        </>
                      )}
                      {/* Only where it changes what she does next. "Opened"
                          on a paid order is trivia; "sent, never opened" on
                          one that owes her money is the reason to send it
                          again rather than to start chasing. */}
                      {row.deliveryStatus === "sent" &&
                        row.balanceCents > 0 &&
                        row.status !== "cancelled" && (
                          <> · not opened</>
                        )}
                    </span>
                  </Link>
                  <span className="shrink-0 text-right">
                    <span className="numeric-body block">
                      <Money amount={row.totalCents / 100} size="body" />
                    </span>
                    <span
                      className={cn(
                        "type-caption block",
                        row.paymentStatus === "paid"
                          ? "text-muted-foreground"
                          : "text-warn-foreground",
                      )}
                    >
                      {row.status === "cancelled"
                        ? "Cancelled"
                        : PAYMENT_LABEL[row.paymentStatus]}
                    </span>
                  </span>
                </div>

                {row.excessCents > 0 && (
                  <p className="type-caption text-muted-foreground">
                    Paid{" "}
                    <span className="numeric">
                      <Money amount={row.excessCents / 100} size="sm" />
                    </span>{" "}
                    more than the total.
                  </p>
                )}

                {justPaid?.rowId === row.id && onUndoPayment && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="type-caption text-muted-foreground">
                      Recorded{" "}
                      <span className="numeric">
                        <Money amount={justPaid.amountCents / 100} size="sm" />
                      </span>
                      .
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onUndoPayment(justPaid.paymentId)}
                    >
                      Undo
                    </Button>
                  </div>
                )}

                {/* One tap, on the list, exactly as CONTEXT.md requires —
                    and on the row that has something to say, which is the
                    delivered one that currently renders no actions at all.
                    Her notes will outnumber the form five to one, so this is
                    the PRIMARY capture path, not a secondary one. */}
                {row.status !== "cancelled" && onLogFeedback && (
                  <div className="flex flex-wrap items-center gap-2">
                    <FeedbackSheet
                      customerName={row.isWalkIn ? "they" : row.customerName}
                      items={row.feedbackItems}
                      onSave={(input) => onLogFeedback(row, input)}
                    />
                    {row.feedbackCount > 0 && (
                      <span className="type-caption text-muted-foreground">
                        <span className="numeric">{row.feedbackCount}</span>{" "}
                        {row.feedbackCount === 1 ? "note" : "notes"}
                        {row.customerReplied && " · they replied"}
                      </span>
                    )}
                  </div>
                )}

                {row.status !== "cancelled" &&
                  row.balanceCents > 0 &&
                  justPaid?.rowId !== row.id && (
                  <div className="flex flex-wrap items-center gap-2">
                    {row.depositShown && onRecordDeposit && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onRecordDeposit(row)}
                      >
                        Deposit{" "}
                        <span className="numeric">
                          <Money amount={row.depositCents / 100} size="sm" />
                        </span>
                      </Button>
                    )}
                    {onRecordFull && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => onRecordFull(row)}
                      >
                        {busy ? "Recording…" : "Paid in full"}
                      </Button>
                    )}
                    <span className="type-caption ml-auto text-muted-foreground">
                      <span className="numeric">
                        <Money amount={row.balanceCents / 100} size="sm" />
                      </span>{" "}
                      outstanding
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
