"use client";

import * as React from "react";
import { ChevronRight, Minus, Plus } from "lucide-react";
import type { Costing, CostLine } from "@/convex/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AnimatedGrams, AnimatedMoney, AnimatedPercent } from "./animated-number";

/**
 * The costing panel. Every derived number opens into the arithmetic that
 * produced it — non-negotiable, because she will not trust a number she
 * cannot take apart.
 *
 * Yield is the exception to live recalculation: it commits on leaving the
 * field (or Enter, or the steppers) rather than per keystroke. Typing "15"
 * passes through "1", and rescaling unit weight to 850 g on the way would
 * make her watch the numbers thrash through nonsense.
 */

function Row({
  line,
  depth = 0,
}: {
  line: CostLine;
  depth?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const expandable = (line.children?.length ?? 0) > 0;

  const content = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        {/* The slot is held open whether or not there's a chevron in it, so
            the names read as one column instead of a ragged edge. */}
        {expandable ? (
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)] ease-out",
              open && "rotate-90",
            )}
          />
        ) : (
          <span aria-hidden className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0">
          <span
            className={cn(
              "type-body block truncate",
              line.kind === "subRecipe" && "text-primary",
            )}
          >
            {line.name}
          </span>
          {/* The working-out, always visible — this IS the traceability. */}
          <span className="type-caption block truncate text-muted-foreground">
            {line.detail}
          </span>
        </span>
      </span>
      <span className="numeric-sm shrink-0 text-right">
        <AnimatedMoney cents={line.centsPerUnit} />
      </span>
    </>
  );

  return (
    <li>
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          // active: matters more than hover here — on a phone there is no
          // hover, and a row that swallows a tap silently feels broken.
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-1 text-left outline-none transition-colors duration-[var(--duration-fast)] ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted md:min-h-9"
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {content}
        </button>
      ) : (
        <div
          className="flex min-h-11 items-center justify-between gap-3 px-1 md:min-h-9"
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {content}
        </div>
      )}
      {expandable && open && (
        <ul className="border-l border-dashed border-border">
          {line.children!.map((child, i) => (
            <Row key={`${child.name}-${i}`} line={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function LayerBlock({
  title,
  caption,
  perUnit,
  perBatch,
  lines,
  defaultOpen,
}: {
  title: string;
  caption?: string;
  perUnit: number;
  perBatch: number;
  lines: CostLine[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-sm px-1 text-left outline-none transition-colors duration-[var(--duration-fast)] ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)] ease-out",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="type-label block">{title}</span>
            {caption && (
              <span className="type-caption block text-muted-foreground">
                {caption}
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="numeric-body block">
            <AnimatedMoney cents={perUnit} />
          </span>
          <span className="numeric-sm block text-muted-foreground">
            <AnimatedMoney cents={perBatch} /> a batch
          </span>
        </span>
      </button>
      {open && (
        <ul className="flex flex-col pb-2">
          {lines.length === 0 ? (
            <li className="type-caption px-2 py-1 text-muted-foreground">
              Nothing here yet.
            </li>
          ) : (
            lines.map((line, i) => <Row key={`${line.name}-${i}`} line={line} />)
          )}
        </ul>
      )}
    </div>
  );
}

export function CostingPanel({
  costing,
  yieldUnits,
  unitWeightMilligrams,
  onYieldCommit,
  driftNotice,
  usedByItems,
  className,
}: {
  costing: Costing;
  yieldUnits: number;
  unitWeightMilligrams: number;
  /** Fires on blur, Enter or the steppers — never on a keystroke. Accepts an
   * updater so rapid stepper taps compose instead of each reading the same
   * stale value and all landing on +1. */
  onYieldCommit: (next: number | ((current: number) => number)) => void;
  driftNotice?: React.ReactNode;
  /** For sub-recipes, which take the place of the margin block. */
  usedByItems?: { id: string; name: string; unitsConsumed: number }[] | null;
  className?: string;
}) {
  // The text buffer resets whenever the committed yield changes (steppers,
  // Escape, a fresh item). Adjusting during render rather than in an effect
  // — the effect version triggers cascading renders.
  const [draftYield, setDraftYield] = React.useState(String(yieldUnits));
  const [lastCommitted, setLastCommitted] = React.useState(yieldUnits);
  if (lastCommitted !== yieldUnits) {
    setLastCommitted(yieldUnits);
    setDraftYield(String(yieldUnits));
  }

  const commit = (raw: string) => {
    const n = Math.round(Number.parseFloat(raw));
    if (Number.isFinite(n) && n > 0 && n !== yieldUnits) onYieldCommit(n);
    else setDraftYield(String(yieldUnits));
  };
  const step = (delta: number) =>
    onYieldCommit((current) => Math.max(1, current + delta));

  const isSubRecipe = usedByItems != null;

  return (
    <section
      aria-label="Costing"
      className={cn("flex flex-col gap-4 rounded-lg border bg-card p-5", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="type-title">What it costs</h2>
          <p className="type-caption text-muted-foreground">
            Every figure opens into its arithmetic.
          </p>
        </div>
        <div className="text-right">
          <p className="numeric-xl">
            <AnimatedMoney cents={costing.totalCentsPerUnit} />
          </p>
          <p className="type-caption text-muted-foreground">
            a unit ·{" "}
            <span className="numeric">
              <AnimatedMoney cents={costing.totalCentsPerBatch} />
            </span>{" "}
            a batch
          </p>
        </div>
      </div>

      {/* Yield and unit weight travel together: same tray, different cuts. */}
      <div className="flex flex-wrap items-end gap-4 rounded-md bg-muted/50 p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="costing-yield" className="type-label">
            Cut into
          </Label>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="One fewer unit"
              onClick={() => step(-1)}
            >
              <Minus aria-hidden />
            </Button>
            <Input
              id="costing-yield"
              value={draftYield}
              inputMode="numeric"
              aria-label="Units per batch"
              className="numeric-body w-16 text-center"
              onChange={(e) => setDraftYield(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setDraftYield(String(yieldUnits));
              }}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="One more unit"
              onClick={() => step(1)}
            >
              <Plus aria-hidden />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="type-label">Each one weighs</span>
          {/* Zero is "she hasn't said", not a measurement. Rendering 0 g would
              be a number she never gave us. */}
          {unitWeightMilligrams > 0 ? (
            <span className="numeric-lg">
              <AnimatedGrams milligrams={unitWeightMilligrams} />
            </span>
          ) : (
            <span className="type-body text-muted-foreground">not set yet</span>
          )}
        </div>
        <p className="type-caption min-w-40 flex-1 text-muted-foreground">
          Same tray, cut differently — cutting more pieces makes each one
          smaller.
        </p>
      </div>

      {driftNotice}

      <div className="flex flex-col rounded-md border">
        <LayerBlock
          title="Ingredients"
          caption="Layer 1 — what goes in"
          perUnit={costing.ingredients.centsPerUnit}
          perBatch={costing.ingredients.centsPerBatch}
          lines={costing.ingredients.lines}
          defaultOpen
        />
        <LayerBlock
          title="Per-unit extras"
          caption="Layer 2 — packaging, box, ribbon"
          perUnit={costing.extras.centsPerUnit}
          perBatch={costing.extras.centsPerBatch}
          lines={costing.extras.lines}
        />
        <LayerBlock
          title="Overhead"
          caption={`Layer 3 — ${Math.round(costing.overhead.minutesPerBatch)} min of your time, gas and power`}
          perUnit={costing.overhead.centsPerUnit}
          perBatch={costing.overhead.centsPerBatch}
          lines={costing.overhead.lines}
        />
      </div>

      {isSubRecipe ? (
        <div className="flex flex-col gap-1.5">
          <p className="type-label">Used in</p>
          {usedByItems!.length === 0 ? (
            <p className="type-caption text-muted-foreground">
              Nothing uses this yet. Add it to a recipe and its cost flows
              through.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {usedByItems!.map((parent) => (
                <li
                  key={parent.id}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="type-body">{parent.name}</span>
                  <span className="numeric-sm text-muted-foreground">
                    {parent.unitsConsumed}{" "}
                    {parent.unitsConsumed === 1 ? "unit" : "units"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <dl className="grid grid-cols-3 gap-3 border-t pt-4">
          <div>
            <dt className="type-caption text-muted-foreground">Gross margin</dt>
            <dd className="numeric-lg">
              {costing.grossMarginPercent === null ? (
                <span className="type-body text-muted-foreground">
                  set a price
                </span>
              ) : (
                <AnimatedPercent
                  percent={costing.grossMarginPercent}
                  className={cn(costing.belowTarget && "text-loss")}
                />
              )}
            </dd>
            <dd className="type-caption text-muted-foreground">
              against layers 1 + 2
            </dd>
          </div>
          <div>
            <dt className="type-caption text-muted-foreground">Net margin</dt>
            <dd className="numeric-lg">
              {costing.netMarginPercent === null ? (
                <span className="type-body text-muted-foreground">—</span>
              ) : (
                <AnimatedPercent percent={costing.netMarginPercent} />
              )}
            </dd>
            <dd className="type-caption text-muted-foreground">
              after all three
            </dd>
          </div>
          <div>
            <dt className="type-caption text-muted-foreground">Your target</dt>
            <dd className="numeric-lg">
              {costing.targetGrossMarginPercent === null ? (
                <span className="type-body text-muted-foreground">—</span>
              ) : (
                `${costing.targetGrossMarginPercent}%`
              )}
            </dd>
            {costing.belowTarget && (
              <dd className="type-caption text-loss-foreground">
                below where you wanted it
              </dd>
            )}
          </div>
        </dl>
      )}
    </section>
  );
}
