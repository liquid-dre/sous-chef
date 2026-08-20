"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import { OrdersList, type OrderRow, type OrdersFilter } from "./orders-list";

export function OrdersListContainer({ orgSlug }: { orgSlug: string }) {
  const [filter, setFilter] = React.useState<OrdersFilter>("upcoming");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  /** The payment just taken on this screen. A one-tap money action must be
   * one tap back — otherwise a mis-tap on the wrong row says "paid" and she
   * stops chasing someone who never paid. */
  const [justPaid, setJustPaid] = React.useState<{
    rowId: string;
    paymentId: string;
    amountCents: number;
  } | null>(null);

  // Her local day, never the server's — a UTC "today" would misfile the
  // whole list for anyone looking at it late in the evening.
  const day = useClientToday();

  const data = useQuery(api.orders.list, day ? { orgSlug, filter, today: day } : "skip");
  const record = useMutation(api.payments.record);
  const removePayment = useMutation(api.payments.remove);
  const logFeedback = useMutation(api.feedback.log);

  if (!data) return <RouteLoading />;

  const pay = async (row: OrderRow, amountCents: number) => {
    setBusyId(row.id);
    try {
      const result = await record({
        orgSlug,
        orderId: row.id as Id<"orders">,
        amountCents,
      });
      setJustPaid({ rowId: row.id, paymentId: result.paymentId, amountCents });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <OrdersList
      orgSlug={orgSlug}
      filter={filter}
      onFilterChange={(f) => {
        // The undo belongs to the row she is looking at; changing the view
        // ends that moment.
        setJustPaid(null);
        setFilter(f);
      }}
      rows={data.rows as OrderRow[]}
      owedCents={data.owedCents}
      owingCount={data.owingCount}
      busyId={busyId}
      justPaid={justPaid}
      onRecordFull={(row) => pay(row, row.balanceCents)}
      onRecordDeposit={(row) => pay(row, row.depositCents)}
      onLogFeedback={async (row, input) => {
        await logFeedback({
          orgSlug,
          orderId: row.id as Id<"orders">,
          menuItemId: input.menuItemId as Id<"menuItems"> | undefined,
          axisRatings: input.axisRatings,
          flags: input.flags,
          freeText: input.freeText,
        });
      }}
      onUndoPayment={async (paymentId) => {
        await removePayment({ orgSlug, paymentId: paymentId as Id<"payments"> });
        setJustPaid(null);
      }}
    />
  );
}
