"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Optimisation, YieldBlock } from "@/convex/lib/optimiser";
import { SolutionSurfaceChart } from "./solution-surface-chart";
import { PortionConstraint } from "./portion-constraint";
import { MIN_YIELDS_FOR_SCATTER, PortionScatter } from "./portion-scatter";
import type {
  OverrideReport,
  PortionEvidence,
} from "@/convex/lib/portionEvidence";

/**
 * The optimiser panel.
 *
 * The language rule is the whole ethic and it is enforced here, not in the
 * solver: Sous knows nothing about demand, so it never instructs. Not "raise
 * your price to $2.74" — "65% would need $2.74". Every string in this file is
 * a statement of arithmetic or a statement of one of her own limits. No
 * imperatives, no congratulation, no confetti. She decides; Sous does the
 * sums.
 *
 * Setting the panel aside is deliberately unjudged and one tap. If she ships
 * at 40% because customers said 12 to a tray was already small, that is a
 * decision Sous records and stops arguing with.
 */

function money(cents: number): string {
  const abs = Math.abs(cents) / 100;
  return `${cents < 0 ? "−" : ""}$${abs.toFixed(2)}`;
}

/** Her own reason for a limit, shown wherever that limit does something. A
 * fence without her words is the thing the required note exists to prevent. */
function BlockNote({ blocks }: { blocks: YieldBlock[] }) {
  const blocking = blocks.filter((b) => b.severity === "blocking");
  const shown = blocking.length > 0 ? blocking : blocks;
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((b) => (
        <p key={b.kind} className="type-caption text-muted-foreground">
          {b.reason}
          {b.note && (
            <>
              {" "}
              <span className="italic">&ldquo;{b.note}&rdquo;</span>
            </>
          )}
        </p>
      ))}
    </div>
  );
}

export function OptimiserPanel({
  optimisation,
  costsMayBeStale = false,
  portionEvidence,
  portionWarning = null,
  overrideReport,
  onOverride,
  onUndoOverride,
  overrideBusy,
  setAsideAt,
  setAsideMarginPercent,
  onSetAside,
  onRestore,
  className,
}: {
  optimisation: Optimisation;
  /**
   * True when an ingredient behind these figures has drifted from its
   * standard cost. Every number here inherits that staleness, and DESIGN.md
   * §4 is absolute about it: a number computed from stale estimates renders
   * with its staleness stated. The costing panel above carries the full
   * warning; this is the one-line acknowledgement so these figures never
   * stand naked.
   */
  costsMayBeStale?: boolean;
  /** Ratings traced to the size each tray was cut at, with the count that
   * could not be traced. Null before the query lands. */
  portionEvidence?: PortionEvidence | null;
  /** The one warning about her CURRENT cut. Null when nobody has said
   * anything about it, or when she has already decided about it — either way
   * the panel is exactly the 1.3 panel. */
  portionWarning?: import("@/convex/lib/optimiser").FeedbackWarning | null;
  /** Present once she has gone ahead at the size she is on. */
  overrideReport?: OverrideReport | null;
  /** Absent when the host cannot persist a decision (an unsaved new item), so
   * the affordance is not offered — same rule as onSetAside. */
  onOverride?: () => void;
  onUndoOverride?: () => void;
  overrideBusy?: boolean;
  setAsideAt: number | null;
  setAsideMarginPercent: number | null;
  /** The margin she is choosing to ship at instead. Absent means the host
   * cannot persist the decision (an unsaved new item), so the affordance is
   * not offered at all — a button that silently does nothing is worse than
   * one that is not there. */
  onSetAside?: (marginPercent: number) => void;
  onRestore?: () => void;
  className?: string;
}) {
  const { verdict, priceToReachTargetAtCurrentYieldCents: needed } = optimisation;
  const target = optimisation.targetGrossMarginPercent;
  const [asking, setAsking] = React.useState(false);
  const [chosen, setChosen] = React.useState("");
  const chosenMargin = Math.round(Number.parseFloat(chosen));
  const chosenValid = Number.isFinite(chosenMargin) && chosenMargin < 100;

  // Set aside: the panel collapses to one line rather than vanishing, so the
  // affordance stays findable and the decision stays visible.
  if (setAsideAt !== null) {
    return (
      <section
        aria-label="Price and yield"
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-5 py-4",
          className,
        )}
      >
        <p className="type-caption min-w-40 flex-1 text-muted-foreground">
          You set this aside
          {setAsideMarginPercent != null && (
            <>
              , shipping at <span className="numeric">{setAsideMarginPercent}%</span>
            </>
          )}
          .
        </p>
        {onRestore && (
          <Button variant="outline" size="sm" onClick={onRestore}>
            Show it again
          </Button>
        )}
      </section>
    );
  }

  const struckNeeded = optimisation.priceToReachTargetAtCurrentYieldBlocks.some(
    (b) => b.kind === "maxPrice" && b.severity === "blocking",
  );

  return (
    <section
      aria-label="Price and yield"
      className={cn("flex flex-col gap-4 rounded-lg border bg-card p-5", className)}
    >
      <div>
        <h2 className="type-title">{verdict.headline}</h2>
        <p className="type-body pt-1 text-muted-foreground">{verdict.detail}</p>
      </div>

      {/* Output 1: the price at her current yield. Stated, never urged. */}
      {needed != null && target != null && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3">
          <span className="type-label">
            <span className="numeric">{target}%</span> at{" "}
            <span className="numeric">{optimisation.currentYield}</span> a tray
            would need
          </span>
          <span
            className={cn(
              "numeric-xl",
              struckNeeded && "text-muted-foreground line-through",
            )}
          >
            {money(needed)}
          </span>
          <BlockNote blocks={optimisation.priceToReachTargetAtCurrentYieldBlocks} />
        </div>
      )}

      {costsMayBeStale && verdict.kind !== "noCost" && (
        <p className="type-caption text-warn-foreground">
          Worked out from your standard costs, which an ingredient has moved
          away from — see the costing above.
        </p>
      )}

      {optimisation.contradictoryConstraints && (
        <p className="type-label rounded-md bg-warn-soft p-3 text-warn-foreground">
          Your fewest units is higher than your most, so nothing can sit inside
          both. Everything below ignores neither — it just cannot satisfy both
          at once.
        </p>
      )}

      <SolutionSurfaceChart
        optimisation={optimisation}
        targetPercent={target}
        complainedYields={portionEvidence?.complainedYields ?? []}
      />

      {/* What customers said about this SIZE, or — once she has decided — what
          has happened since. Never both: re-raising a warning she has already
          weighed would be Sous making the same point twice. */}
      <PortionConstraint
        warning={portionWarning}
        evidence={portionEvidence ?? null}
        report={overrideReport ?? null}
        currentYield={optimisation.currentYield}
        onOverride={onOverride}
        onUndoOverride={onUndoOverride}
        busy={overrideBusy}
      />

      {/* Only once two sizes have actually been served. One yield is a fact
          about one number, not a correlation, and the chart is not rendered
          rather than drawn and then disclaimed. */}
      {portionEvidence &&
        portionEvidence.byYield.length >= MIN_YIELDS_FOR_SCATTER && (
          <PortionScatter evidence={portionEvidence} />
        )}

      {/* Everything feedback says that is NOT about portion size — "too
          expensive" and anything a later axis adds. The portion block above
          owns its own kind, so it is excluded here rather than printed twice. */}
      {optimisation.feedbackWarnings
        .filter((w) => w.kind !== "portionTooSmall")
        .map((w) => (
          <div
            key={w.kind}
            className="flex flex-col gap-0.5 rounded-md bg-warn-soft p-3 text-warn-foreground"
          >
            <p className="type-label">{w.detail}</p>
            <p className="type-caption">
              From <span className="numeric">{w.sampleSize}</span>{" "}
              {w.sampleSize === 1 ? "rating" : "ratings"}.
            </p>
          </div>
        ))}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {!onSetAside ? (
          <p className="type-caption text-muted-foreground">
            This is arithmetic, not advice. Sous does not know your customers.
          </p>
        ) : asking ? (
          <div className="flex w-full flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="optimiser-shipped" className="type-label">
                What you are shipping at
              </Label>
              <div className="relative w-28">
                <Input
                  id="optimiser-shipped"
                  value={chosen}
                  inputMode="decimal"
                  placeholder="40"
                  // Focused on reveal: she tapped to answer a question, so
                  // she should not have to tap again to start answering it.
                  autoFocus
                  className="numeric-body pr-7 md:pr-7"
                  onChange={(e) => setChosen(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && chosenValid) {
                      onSetAside?.(chosenMargin);
                      setAsking(false);
                    }
                    if (e.key === "Escape") setAsking(false);
                  }}
                />
                <span className="type-caption pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground">
                  %
                </span>
              </div>
            </div>
            <Button
              // Disabled rather than silently closing on an empty field —
              // a control that appears to work and does nothing is a lie.
              disabled={!chosenValid}
              onClick={() => {
                onSetAside?.(chosenMargin);
                setAsking(false);
              }}
            >
              Set it aside
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <p className="type-caption min-w-40 flex-1 text-muted-foreground">
              This is arithmetic, not advice. Sous does not know your customers.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
              Set this aside
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
