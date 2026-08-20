"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * "Log a buttercream batch too?"
 *
 * CONTEXT.md promises exactly this sentence and nothing has ever kept it. It
 * matters more than it looks, because it is the alternative to a much worse
 * design: a production log NEVER recurses into a sub-recipe's raw
 * ingredients. Recursing would move flour and butter with no production log
 * behind them — no cost snapshot, no yield variance, no overhang — and what a
 * batch of buttercream actually cost would become unanswerable forever.
 *
 * So Sous notices the shelf is short and offers to log a real batch of the
 * sub. One tap, both logs, one transaction, and the leaves come off through
 * the sub's own record.
 *
 * TICKED BY DEFAULT, which is the whole point of "one tap": she is standing
 * in the kitchen having just made the buttercream, and the common case must
 * cost her nothing. Unticking is one tap too, and Sous logs the parent alone
 * without complaint — she may well have made it last night. It flags, it
 * never instructs.
 */

export interface SubShortfall {
  subMenuItemId: string;
  name: string;
  neededMilli: number;
  onHandMilli: number;
  shortMilli: number;
  batchesToCover: number;
}

function units(milli: number): string {
  const n = milli / 1000;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function SubRecipePrompt({
  shortfalls,
  chosen,
  onToggle,
}: {
  shortfalls: SubShortfall[];
  /** Sub ids she has agreed to log alongside. */
  chosen: string[];
  onToggle: (subMenuItemId: string, next: boolean) => void;
}) {
  if (shortfalls.length === 0) return null;

  return (
    <section
      aria-label="Sub-recipes you are short of"
      className="flex flex-col gap-3 rounded-lg bg-warn-soft p-4 text-warn-foreground"
    >
      {shortfalls.map((s) => {
        const id = `log-sub-${s.subMenuItemId}`;
        return (
          <div key={s.subMenuItemId} className="flex flex-col gap-1.5">
            {/* The arithmetic first, the offer second. She decides from the
                numbers, not from the tick. */}
            <p className="type-label text-pretty">
              This needs <span className="numeric">{units(s.neededMilli)}</span>{" "}
              {s.name.toLowerCase()} and you have{" "}
              <span className="numeric">{units(s.onHandMilli)}</span>.
            </p>
            {/* A 20px checkbox is not a tap target. The label is bound to it
                and the whole band is 44px tall, so anywhere on this line
                works — she is holding a tray. */}
            <div className="flex min-h-11 items-center gap-2.5">
              <Checkbox
                id={id}
                checked={chosen.includes(s.subMenuItemId)}
                onCheckedChange={(v) => onToggle(s.subMenuItemId, v === true)}
                className="size-5 shrink-0"
              />
              <Label htmlFor={id} className="type-body flex-1 py-2.5 text-pretty">
                Log{" "}
                <span className="numeric">{s.batchesToCover}</span>{" "}
                {s.batchesToCover === 1 ? "batch" : "batches"} of {s.name} too
              </Label>
            </div>
          </div>
        );
      })}
      <p className="type-caption">
        Leave it unticked and Sous logs this batch on its own — the{" "}
        {shortfalls.length === 1 ? "shortfall stays" : "shortfalls stay"} on the
        record either way.
      </p>
    </section>
  );
}
