"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toBaseMilli } from "@/convex/lib/drift";
import { PACK_UNITS_FOR, type BaseUnit, type PackUnit } from "./format";

/**
 * The two movements with no document behind them: something went in the bin,
 * and something was simply wrong.
 *
 * The reason is REQUIRED on both, and the server enforces it as well. Six
 * months on, an unexplained −2 kg is indistinguishable from a slipped
 * decimal; the note is the only thing that turns it into evidence. Same
 * argument that makes menuItems.constraintNote required — a correction
 * without its reason rots.
 *
 * Waste and adjustment are kept apart rather than collapsed into one signed
 * field, because they mean different things to the leak arithmetic: waste is
 * food that was bought and thrown away, an adjustment is Sous having been
 * wrong. Merging them would make her waste rate depend on how she happened to
 * phrase a correction.
 */

/** Exported so the specimen can mount it with a pretend save — everything
 * else on that page is Convex-free and this must not be the one exception
 * that makes the grading surface depend on a live session. */
export function MovementDialog({
  trigger,
  title,
  description,
  quantityLabel,
  notePlaceholder,
  baseUnit,
  signed,
  onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  quantityLabel: string;
  notePlaceholder: string;
  baseUnit: BaseUnit;
  /** Adjustments go both ways; waste only ever comes off. */
  signed: boolean;
  onSubmit: (milli: number, note: string) => Promise<unknown>;
}) {
  const units = PACK_UNITS_FOR[baseUnit];
  const [open, setOpen] = React.useState(false);
  const [qty, setQty] = React.useState("");
  const [unit, setUnit] = React.useState<PackUnit>(units[units.length - 1]);
  const [direction, setDirection] = React.useState<1 | -1>(1);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const parsed = Number.parseFloat(qty);
  const valid =
    Number.isFinite(parsed) && parsed > 0 && note.trim() !== "" && !busy;

  const reset = () => {
    setQty("");
    setNote("");
    setDirection(1);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {signed && (
            <div className="flex flex-col gap-1.5">
              <Label>Which way</Label>
              {/* The Button primitive, not a hand-rolled <button>: it is
                  where `active:scale-[0.97]`, the focus ring and the named
                  transition properties live. A bare button here looks
                  identical until she presses it and nothing acknowledges
                  her. */}
              <div className="flex w-fit gap-0.5 rounded-md border p-0.5">
                {([
                  { value: 1 as const, label: "More than Sous thinks" },
                  { value: -1 as const, label: "Less" },
                ]).map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={direction === option.value ? "secondary" : "ghost"}
                    // Announced as well as tinted — the state must survive
                    // greyscale and a screen reader (DESIGN.md §4).
                    aria-pressed={direction === option.value}
                    className={cn(
                      "type-caption h-11 px-3",
                      direction !== option.value && "text-muted-foreground",
                    )}
                    onClick={() => setDirection(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="movement-qty">{quantityLabel}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="movement-qty"
                value={qty}
                inputMode="decimal"
                placeholder="0"
                autoFocus
                className="numeric-body h-11 w-32"
                onChange={(e) => setQty(e.target.value)}
              />
              <div className="flex gap-0.5 rounded-md border p-0.5">
                {units.map((u) => (
                  <Button
                    key={u}
                    type="button"
                    size="sm"
                    variant={unit === u ? "secondary" : "ghost"}
                    aria-pressed={unit === u}
                    className={cn(
                      "type-caption h-11 px-2.5",
                      unit !== u && "text-muted-foreground",
                    )}
                    onClick={() => setUnit(u)}
                  >
                    {u}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="movement-note">What happened</Label>
            <Input
              id="movement-note"
              value={note}
              placeholder={notePlaceholder}
              className="h-11"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && (
            <p className="type-caption text-loss" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            // Disabled rather than failing on submit: the reason is not
            // optional and the button should say so before she taps it.
            disabled={!valid}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const milli = toBaseMilli(Math.round(parsed * 1000), unit);
                await onSubmit(signed ? milli * direction : milli, note.trim());
                setOpen(false);
                reset();
              } catch (e) {
                setError(e instanceof Error ? e.message : "That didn't save.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Record it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MovementDialogs({
  orgSlug,
  ingredientId,
  name,
  baseUnit,
}: {
  orgSlug: string;
  ingredientId: Id<"ingredients">;
  name: string;
  baseUnit: BaseUnit;
}) {
  const recordWaste = useMutation(api.stock.recordWaste);
  const recordAdjustment = useMutation(api.stock.recordAdjustment);

  return (
    <div className="flex flex-wrap gap-2">
      <MovementDialog
        trigger={
          <Button variant="outline" size="sm">
            Threw some away
          </Button>
        }
        title={`Throw away some ${name.toLowerCase()}?`}
        description="It comes off the amount on hand and stays on the books as waste."
        quantityLabel="How much"
        notePlaceholder="Weevils in the bag"
        baseUnit={baseUnit}
        signed={false}
        onSubmit={(milli, note) =>
          recordWaste({ orgSlug, ingredientId, qtyMilli: milli, note })
        }
      />
      <MovementDialog
        trigger={
          <Button variant="ghost" size="sm">
            Correct the amount
          </Button>
        }
        title={`Correct the ${name.toLowerCase()}?`}
        // Said plainly, because the difference decides whether the freshness
        // age resets — and a correction is not a count.
        description="For a bag you found or a delivery with no receipt. This moves the amount without counting the whole lot, so it does not refresh how old the figure is."
        quantityLabel="How far out"
        notePlaceholder="Bag found behind the sugar"
        baseUnit={baseUnit}
        signed
        onSubmit={(milli, note) =>
          recordAdjustment({ orgSlug, ingredientId, deltaMilli: milli, note })
        }
      />
    </div>
  );
}
