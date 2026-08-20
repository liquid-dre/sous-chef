"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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

/**
 * Cancelling needs a reason (CONTEXT.md — Orders), enforced server-side too.
 * The reason is the only thing that will explain the gap in next month's
 * numbers, so the field is required rather than encouraged.
 *
 * When a batch was already made, the dialog says plainly that the cost stays
 * on the books — she should find that out here, not by wondering why her
 * ingredients are down and her sales aren't up.
 */
export function CancelOrderDialog({
  invoiceLabel,
  batchesMade,
  onCancelOrder,
}: {
  invoiceLabel: string;
  /** Batches already logged against this order, if any. */
  batchesMade: number;
  onCancelOrder: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ready = reason.trim() !== "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost">Cancel this order</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {invoiceLabel}?</DialogTitle>
          <DialogDescription>
            It stays in your records as a cancelled order, keeping its number.
          </DialogDescription>
        </DialogHeader>

        {batchesMade > 0 && (
          <p className="type-label rounded-md bg-warn-soft p-3 text-warn-foreground">
            You already made {batchesMade}{" "}
            {batchesMade === 1 ? "batch" : "batches"} for this. That cost stays
            on the books as waste — it really was spent.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cancel-reason" className="type-label">
            Why? <span className="text-loss">Required</span>
          </Label>
          <Textarea
            id="cancel-reason"
            rows={2}
            value={reason}
            autoFocus
            placeholder="Her event was called off."
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="type-caption text-muted-foreground">
            In six months this is the only thing that will explain the gap.
          </p>
        </div>

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
            <Button variant="ghost">Keep it</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onCancelOrder(reason.trim());
                setOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Couldn't cancel it — try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Cancelling…" : "Cancel the order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
