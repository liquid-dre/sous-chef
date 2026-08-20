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
import { firstName } from "@/lib/whatsapp";

/**
 * Stopping marketing to one person. One way, and it asks first.
 *
 * "One-tap opt-out" (CONTEXT.md — Comms) is about how findable the control
 * is, not about the absence of a confirm: DESIGN.md's NEVER SHIP list makes a
 * destructive action without confirmation an automatic fail, and this one
 * cannot be undone through Sous at all. So the control sits in plain sight
 * with nothing buried, and the dialog says exactly what she is about to make
 * permanent.
 *
 * The copy is careful about WHY it is permanent, because "we won't let you
 * undo this" reads as software being difficult unless the reason is given.
 * POPIA and Zimbabwe's Data Protection Act both put consent in the customer's
 * hands: she can stop, but only they can start it again. That is the sentence
 * the dialog makes.
 *
 * Modelled on `components/menu/remove-item-dialog.tsx`, the repo's template
 * for irreversible confirms — there is no `AlertDialog` in this codebase and
 * every confirmation is a plain `Dialog`.
 */
export function OptOutDialog({
  name,
  onOptOut,
}: {
  name: string;
  onOptOut: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const hi = firstName(name) || "them";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="min-h-11 md:min-h-9">
          Stop marketing to {hi}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop marketing to {hi}?</DialogTitle>
          <DialogDescription>
            {hi} stops appearing in reorder reminders and campaigns, from now
            on. Sous cannot undo this — only {hi} can ask to hear from you
            again.
          </DialogDescription>
        </DialogHeader>
        {/* What she is NOT losing. Without this the dialog reads as "delete
            this customer", which is not what it does. */}
        <p className="type-body text-muted-foreground">
          Their orders, history and what they are worth to you all stay exactly
          as they are. You can still take orders from them and message them
          about one.
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
            {/* Never "Cancel" — the safe choice says what it does. No size
                override: the Button base is already `h-11 md:h-9`, so this is
                44px under a thumb and compact on a desktop, matching every
                other dialog in the app. */}
            <Button variant="ghost">Keep marketing to {hi}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onOptOut();
                setOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Couldn't save that — try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Opt them out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
