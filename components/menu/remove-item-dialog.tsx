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
 * Removing a menu item is destructive and irreversible, so it asks first —
 * DESIGN.md §8 treats an unconfirmed destructive action as an outright fail.
 *
 * The dialog answers the question she will actually have, which is not "are
 * you sure" but "does this rewrite what I already sold?". It does not:
 * orderLines carry their own cogsSnapshot, immutable by the time a line is
 * delivered. Saying so is the whole point of the pause.
 *
 * Sub-recipes still in use are refused by the server, which names the parents.
 * That error surfaces here rather than after the dialog closes.
 */
export function RemoveItemDialog({
  name,
  lineCount,
  onRemove,
}: {
  name: string;
  /** Recipe lines that go with it — the concrete thing being destroyed. */
  lineCount: number;
  onRemove: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const label = name.trim() || "this item";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" className="ml-auto">
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {label}?</DialogTitle>
          <DialogDescription>
            {label} goes, along with{" "}
            {lineCount === 1 ? "its one recipe line" : `its ${lineCount} recipe lines`}
            . You cannot undo this.
          </DialogDescription>
        </DialogHeader>
        <p className="type-body text-muted-foreground">
          Orders you have already taken keep the costs they were quoted at —
          their history does not move.
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
