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

/**
 * Replacing the link breaks something that is already out in the world, so it
 * asks first — the same rule as cancelling an order.
 *
 * The dialog says exactly what survives and what does not, because the
 * consequences are asymmetric and unguessable: the old link dies for whoever
 * has it (including the right customer, if she sent it to both), the PDF
 * anyone already downloaded keeps working forever, and "opened" resets because
 * nobody has opened the new one.
 */
export function ReplaceLinkDialog({
  invoiceLabel,
  wasViewed,
  onReplace,
}: {
  invoiceLabel: string;
  /** Changes what she is actually giving up. */
  wasViewed: boolean;
  onReplace: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
          Replace the link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace the link for {invoiceLabel}?</DialogTitle>
          <DialogDescription>
            Use this if it went to the wrong person. You&rsquo;ll get a fresh
            link to send to the right one.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-1.5 type-body text-muted-foreground">
          <li>
            The old link stops working immediately — for{" "}
            <span className="text-foreground">anyone</span> who has it.
          </li>
          <li>
            A PDF that has already been downloaded keeps working. Replacing the
            link cannot take that back.
          </li>
          {wasViewed && (
            <li className="text-warn-foreground">
              This one has been opened, so &ldquo;opened&rdquo; resets — the new
              link has been seen by nobody.
            </li>
          )}
        </ul>

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
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onReplace();
                setOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Couldn't replace it — try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Replacing…" : "Replace the link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
