"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/numeric/money-input";
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
 * Any amount at all, for when what she was handed isn't the balance and
 * isn't the deposit — $17 in notes against a $23 order.
 *
 * Pre-filled with the outstanding balance because that is the commonest
 * answer, and overpayment is deliberately not blocked: the money arrived,
 * and refusing to record it would make the ledger disagree with the tin.
 */
export function RecordPaymentDialog({
  balanceCents,
  onRecord,
  trigger,
}: {
  balanceCents: number;
  onRecord: (amountCents: number, method: string) => Promise<void>;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cents = React.useMemo(() => {
    const n = Number.parseFloat(amount.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }, [amount]);
  const ready = cents != null && cents > 0;
  const over = cents != null && cents > balanceCents ? cents - balanceCents : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setAmount((balanceCents / 100).toFixed(2));
          setMethod("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline">Record a payment</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What did she pay?</DialogTitle>
          <DialogDescription>
            {balanceCents > 0
              ? `${formatMoney(balanceCents / 100)} is outstanding.`
              : "This order is already settled."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-amount" className="type-label">
              Amount
            </Label>
            <MoneyInput
              id="payment-amount"
              value={amount}
              onChange={setAmount}
              aria-label="Amount paid"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-method" className="type-label">
              How <span className="text-muted-foreground">optional</span>
            </Label>
            <Input
              id="payment-method"
              value={method}
              placeholder="Cash, EcoCash, transfer…"
              onChange={(e) => setMethod(e.target.value)}
            />
          </div>
          {over > 0 && (
            <p className="type-caption text-muted-foreground">
              That is {formatMoney(over / 100)} more than the total. It will be
              recorded as it is — nothing is blocked.
            </p>
          )}
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
            <Button variant="ghost">Not now</Button>
          </DialogClose>
          <Button
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onRecord(cents!, method);
                setOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Couldn't record it — try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Recording…" : "Record it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
