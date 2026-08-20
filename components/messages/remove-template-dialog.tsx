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
 * Removing a template. Destructive and irreversible, so it asks — DESIGN.md
 * §8 makes an unconfirmed destructive action an outright fail.
 *
 * The question she actually has is not "are you sure" but "does this stop the
 * weekly message going out", so that is the sentence the dialog leads with
 * when a schedule points at it. Messages already sent are untouched: their
 * words were copied onto the outbox rows when the batch started.
 *
 * Modelled on `components/menu/remove-item-dialog.tsx`, this repo's template
 * for irreversible confirms — there is no `AlertDialog` here and every
 * confirmation is a plain `Dialog`.
 */
export function RemoveTemplateDialog({
  name,
  hasSchedule,
  onRemove,
}: {
  name: string;
  /** A weekly rule points at it, which is the consequence she cares about. */
  hasSchedule: boolean;
  onRemove: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const label = name.trim() || "this template";

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
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {label}?</DialogTitle>
          <DialogDescription>
            {hasSchedule
              ? "Its weekly schedule goes with it, so nothing will be drafted on that day any more. You cannot undo this."
              : "The wording goes. You cannot undo this."}
          </DialogDescription>
        </DialogHeader>
        <p className="type-body text-muted-foreground">
          Messages already queued or sent keep their words — they were copied
          when the batch started.
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
            {/* Never "Cancel" — the safe choice says what it does. */}
            <Button variant="ghost">Keep it</Button>
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
            {busy ? "Removing…" : `Remove ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
