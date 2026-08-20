"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatMoney } from "@/components/numeric/money";

/**
 * Removing a recorded payment asks first — DESIGN.md §8 treats an
 * unconfirmed destructive action as an outright fail, and this destroys a
 * record of money that may be months old.
 *
 * Deliberately NOT the same as the Undo on the orders list. That reverses a
 * tap taken seconds ago and is itself the safety net; putting a dialog in
 * front of it would defeat the thing it exists to do. This is a different
 * act: reaching back into the ledger.
 *
 * The copy is careful about which act this is. Removing a payment says it
 * never happened. Giving money back is a refund, which Sous does not do yet
 * — and conflating the two would make the cash-received view unable to tell
 * a mis-tap from a returned $40.
 */
export function RemovePaymentDialog({
  amountCents,
  paidAt,
  onRemove,
}: {
  amountCents: number;
  paidAt: number;
  onRemove: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const when = new Date(paidAt).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Remove the {formatMoney(amountCents / 100)} from {when}?
          </DialogTitle>
          <DialogDescription>
            This says the payment never happened, and the order goes back to
            owing it.
          </DialogDescription>
        </DialogHeader>
        <p className="type-body text-muted-foreground">
          If you gave the money back instead, leave this here — that is a
          refund, and it is a different thing from a payment that was never
          made.
        </p>
        {error && (
          <p
            className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground"
            role="alert"
          >
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Leave it</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onRemove();
                setOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Couldn't remove it — try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Removing…" : "Remove it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
