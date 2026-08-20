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
import { formatUnitPrice, type BaseUnit } from "./format";

/**
 * Adopting the median is not destructive — orderLine cogsSnapshots are
 * immutable, which convex/pantry.test.ts proves byte-for-byte. The confirm
 * exists to say so out loud, because "will this rewrite my history?" is
 * exactly the fear that stops someone pressing the button.
 */
export function AdoptMedianDialog({
  name,
  baseUnit,
  standardCentsPerThousand,
  medianCentsPerThousand,
  percent,
  onAdopt,
}: {
  name: string;
  baseUnit: BaseUnit;
  standardCentsPerThousand: number;
  medianCentsPerThousand: number;
  percent: number;
  onAdopt: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Update standard cost</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cost {name} at its recent price?</DialogTitle>
          <DialogDescription>
            {name} moves from{" "}
            {formatUnitPrice(standardCentsPerThousand, baseUnit)} to{" "}
            {formatUnitPrice(medianCentsPerThousand, baseUnit)} — the middle of
            your last three purchases, {percent > 0 ? "up" : "down"}{" "}
            {Math.abs(percent)}%.
          </DialogDescription>
        </DialogHeader>
        <p className="type-body text-muted-foreground">
          This changes what new orders are costed at. Orders you have already
          taken keep the costs they were quoted at — their history does not
          move.
        </p>
        {error && (
          <p className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Leave it</Button>
          </DialogClose>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onAdopt();
                setOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Couldn't update — try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Updating…" : "Update standard cost"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
