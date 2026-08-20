"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SavedOrderView } from "./saved-order-view";
import type { EmailResult } from "./invoice-card";

export function SavedOrderContainer({
  orgSlug,
  orderId,
  /** From the server: whether a sending domain is connected at all. The
   * client cannot see server env, and a kitchen without one should never be
   * offered an Email button that can only fail. */
  emailConfigured = false,
}: {
  orgSlug: string;
  orderId: string;
  emailConfigured?: boolean;
}) {
  const data = useQuery(api.orders.get, {
    orgSlug,
    orderId: orderId as Id<"orders">,
  });
  const cancel = useMutation(api.orders.cancel);
  const record = useMutation(api.payments.record);
  const removePayment = useMutation(api.payments.remove);
  const materialise = useMutation(api.invoices.materialise);
  const markSent = useMutation(api.invoices.markSent);
  const replaceToken = useMutation(api.invoices.replaceToken);

  if (!data) return null;

  return (
    <SavedOrderView
      data={{ ...data, emailConfigured }}
      onCancelOrder={async (reason) => {
        await cancel({ orgSlug, orderId: orderId as Id<"orders">, reason });
      }}
      onRecordPayment={async (amountCents, method) => {
        await record({
          orgSlug,
          orderId: orderId as Id<"orders">,
          amountCents,
          method: method || undefined,
        });
      }}
      onRemovePayment={async (paymentId) => {
        await removePayment({ orgSlug, paymentId: paymentId as Id<"payments"> });
      }}
      onIssueInvoice={async () => {
        await materialise({ orgSlug, orderId: orderId as Id<"orders"> });
      }}
      // Both mutations are idempotent, so a double tap on a slow connection
      // cannot issue twice or re-stamp the send date.
      onSendInvoice={async () => {
        await markSent({ orgSlug, orderId: orderId as Id<"orders"> });
      }}
      onReplaceLink={async () => {
        await replaceToken({ orgSlug, orderId: orderId as Id<"orders"> });
      }}
      // Resolves with the outcome rather than throwing: a refused send is a
      // sentence she has to read, not an exception to swallow. The route
      // decides the recipient — this never sends one.
      onEmailInvoice={async (): Promise<EmailResult> => {
        try {
          const res = await fetch("/api/invoice/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgSlug, orderId }),
          });
          return (await res.json()) as EmailResult;
        } catch {
          return {
            ok: false,
            message: "Couldn't reach the server. Nothing was sent.",
          };
        }
      }}
    />
  );
}
