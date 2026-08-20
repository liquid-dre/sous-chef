"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FeedbackWarning } from "@/convex/lib/optimiser";
import {
  coverageNote,
  type OverrideReport,
  type PortionEvidence,
} from "@/convex/lib/portionEvidence";

/**
 * What customers said about this SIZE, beside the arithmetic — never instead
 * of it.
 *
 * CONTEXT.md: feedback constrains the optimiser as a warning, never a veto,
 * and the chef has final say. So this block never disables anything, never
 * strikes a bar, and never hides a number. It says what people said, states
 * how many said it, and offers one unjudged button.
 *
 * Two states, and only ever one of them:
 *
 * - Before she decides, the WARNING. Specific to her current cut, and it says
 *   so — "12 a tray was already too small" rather than a general grumble about
 *   the item.
 * - After she decides, the REPORT. Facts on both sides, no cause named, no
 *   yield proposed. Sous does not get to say "I told you so", and it does not
 *   get to re-raise a decision she has already weighed — which is why the
 *   report replaces the warning rather than sitting under it.
 *
 * The coverage note is not optional decoration. A figure that hides how much
 * of the evidence it could actually place would let her act on "4 of 5" while
 * three more ratings sat unplaceable, and that is the failure the whole
 * portion-evidence module exists to prevent.
 */

export function PortionConstraint({
  warning,
  evidence,
  report,
  currentYield,
  onOverride,
  onUndoOverride,
  busy,
}: {
  /** Null when nobody has said anything about this size. */
  warning: FeedbackWarning | null;
  evidence: PortionEvidence | null;
  /** Present once she has decided about the size she is on. */
  report: OverrideReport | null;
  currentYield: number;
  onOverride?: () => void;
  onUndoOverride?: () => void;
  busy?: boolean;
}) {
  const coverage = evidence ? coverageNote(evidence) : null;

  if (report) {
    return (
      <section
        aria-label="Since you decided"
        className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3"
      >
        <div className="flex flex-col gap-1">
          <h3 className="type-label text-muted-foreground">
            You went ahead at{" "}
            <span className="numeric">{report.yieldUnits}</span> a tray
          </h3>
          {report.sentences.map((sentence) => (
            <p key={sentence} className="type-body text-pretty">
              {sentence}
            </p>
          ))}
        </div>

        {coverage && (
          <p className="type-caption text-muted-foreground">{coverage}</p>
        )}

        {/* No proposed yield here on purpose. Every alternative cut is already
            on the chart above with its own margin and its own mark, so she can
            see 13 and 14 without Sous pointing at one — which is the line
            between stating arithmetic and giving advice. */}
        <p className="type-caption text-muted-foreground">
          Every other size is still on the chart above.
        </p>

        {onUndoOverride && (
          <div>
            <Button variant="outline" size="sm" onClick={onUndoOverride} disabled={busy}>
              Show the warning again
            </Button>
          </div>
        )}
      </section>
    );
  }

  if (!warning) return null;

  return (
    <section
      aria-label="What customers said about this size"
      className={cn(
        "flex flex-col gap-3 rounded-md p-3",
        "bg-warn-soft text-warn-foreground",
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="type-label text-pretty">{warning.detail}</p>
        <p className="type-caption">
          {/* The sample size has been on FeedbackWarning since it was written
              and has never once been rendered. A count without a denominator
              is not a claim (DESIGN.md §5). */}
          From <span className="numeric">{warning.sampleSize}</span>{" "}
          {warning.sampleSize === 1 ? "rating" : "ratings"} traced to trays cut
          to <span className="numeric">{currentYield}</span>.
          {coverage ? ` ${coverage}` : ""}
        </p>
      </div>

      {onOverride && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onOverride} disabled={busy}>
            Go ahead anyway
          </Button>
          <span className="type-caption">
            Sous records that you decided, and stops raising it.
          </span>
        </div>
      )}
    </section>
  );
}
