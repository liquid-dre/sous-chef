"use client";

import { cn } from "@/lib/utils";
import {
  formatDriftPercent,
  formatSetAt,
  formatUnitPrice,
  type BaseUnit,
} from "./format";

/**
 * Cost drift, rendered as a factual comparison — old cost, new cost, %
 * change, and what it does to margin. No alarm language. No exclamation
 * marks. Sous flags; it never instructs.
 */

export interface DriftShape {
  medianCentsPerThousand: number | null;
  standardCentsPerThousand: number;
  percent: number | null;
  severity: "none" | "amber" | "red";
  drifted: boolean;
  stale: boolean;
  staleDays: number;
  purchaseCount: number;
  hasEnoughData: boolean;
}

/** A quiet chip for list rows. Renders nothing when there's nothing to say —
 * absence, not a green "all good" badge competing for attention. */
export function DriftBadge({
  drift,
  muted,
}: {
  drift: DriftShape;
  muted: boolean;
}) {
  if (muted || (!drift.drifted && !drift.stale)) return null;
  if (drift.drifted && drift.percent !== null) {
    return (
      <span
        className={cn(
          "numeric-sm rounded-full px-2 py-0.5",
          drift.severity === "red"
            ? "bg-loss-soft text-loss-foreground"
            : "bg-warn-soft text-warn-foreground",
        )}
      >
        {formatDriftPercent(drift.percent)}
      </span>
    );
  }
  return (
    <span className="type-caption rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
      priced {drift.staleDays} days ago
    </span>
  );
}

/** The full comparison, for the ingredient screen and the purchase review. */
export function DriftComparison({
  baseUnit,
  standardSetAt,
  drift,
  marginNow,
  marginIfAdopted,
  targetPercent,
  className,
}: {
  baseUnit: BaseUnit;
  standardSetAt: number;
  drift: DriftShape;
  /** Optional: the item-level arithmetic, when this is shown against one. */
  marginNow?: number;
  marginIfAdopted?: number;
  targetPercent?: number | null;
  className?: string;
}) {
  if (!drift.hasEnoughData) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <p className="type-body text-muted-foreground">
          {drift.purchaseCount === 0
            ? "No purchases recorded yet."
            : `${drift.purchaseCount} of 3 purchases recorded.`}{" "}
          Sous compares the middle of your last three prices, so it needs three
          before it can say anything about drift.
        </p>
        {drift.stale && (
          <p className="type-body text-warn-foreground">
            This cost was {formatSetAt(standardSetAt).replace("set ", "set ")} —
            worth checking against a recent receipt.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <dl className="grid grid-cols-3 gap-3">
        <Cell label="Standard cost">
          {formatUnitPrice(drift.standardCentsPerThousand, baseUnit)}
        </Cell>
        <Cell label="Middle of last 3">
          {formatUnitPrice(drift.medianCentsPerThousand!, baseUnit)}
        </Cell>
        <Cell
          label="Difference"
          tone={
            !drift.drifted
              ? undefined
              : drift.severity === "red"
                ? "loss"
                : "warn"
          }
        >
          {formatDriftPercent(drift.percent!)}
        </Cell>
      </dl>

      {marginNow !== undefined && marginIfAdopted !== undefined && (
        <dl className="grid grid-cols-3 gap-3 border-t pt-3">
          <Cell label="Gross margin now">{marginNow}%</Cell>
          <Cell
            label="If you adopt"
            tone={
              targetPercent != null && marginIfAdopted < targetPercent
                ? "loss"
                : undefined
            }
          >
            {marginIfAdopted}%
          </Cell>
          {targetPercent != null && <Cell label="Your target">{targetPercent}%</Cell>}
        </dl>
      )}

      <p className="type-caption text-muted-foreground">
        {formatSetAt(standardSetAt)}. Orders already placed keep the costs they
        were quoted at.
      </p>
    </div>
  );
}

function Cell({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "loss" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="type-caption text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "numeric-body",
          tone === "loss" && "text-loss",
          tone === "warn" && "text-warn-foreground",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
