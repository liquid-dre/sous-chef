"use client";

import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { formatMoneyExact } from "./format";

/**
 * DESIGN.md traceability, solved once: every money figure on every cartesian
 * chart opens into its three cost layers. Attach `costLayers` to the datum
 * and drop <CostTooltip> into the chart — eighteen future screens inherit
 * the behaviour. Sankey/Heatmap use their own tooltip components with the
 * same formatters.
 *
 * Tooltip motion note (emil): the panel tracks the crosshair with a spring —
 * positional tracking, not an appearance animation — and appearance after
 * the first hover is instant.
 */

export interface CostLayers {
  ingredientsCents: number;
  perUnitExtrasCents: number;
  overheadCents: number;
}

/** Attach to chart rows to make their money figures traceable. */
export interface TraceableDatum {
  costLayers?: CostLayers;
}

const LAYERS: { key: keyof CostLayers; label: string }[] = [
  { key: "ingredientsCents", label: "Ingredients" },
  { key: "perUnitExtrasCents", label: "Packaging" },
  { key: "overheadCents", label: "Overhead" },
];

/** An extra fact about the point, shown under the layers. */
export interface TooltipExtraRow {
  label: string;
  value: string;
  /** Struck through, for a figure a limit rules out. */
  struck?: boolean;
}

export function CostTooltip({
  valueKey,
  valueLabel,
  header,
  extraRows,
}: {
  /** The datum field holding the money value, in cents. */
  valueKey: string;
  valueLabel: string;
  /**
   * Replaces the date pill. Charts whose X is not time need it — without
   * this the pill formats the x value as a date, which on a units-per-batch
   * axis is nonsense.
   */
  header?: (point: Record<string, unknown>) => string;
  /** Facts that are not cost layers: a weight, a margin, a target price. */
  extraRows?: (point: Record<string, unknown>) => TooltipExtraRow[];
}) {
  return (
    <ChartTooltip
      showDatePill={header === undefined}
      content={({ point }) => {
        const cents = point[valueKey];
        if (typeof cents !== "number") return null;
        const layers = point.costLayers as CostLayers | undefined;
        const extras = extraRows?.(point) ?? [];
        return (
          <div className="flex min-w-40 flex-col gap-1 p-1">
            {header && (
              <span className="type-label pb-0.5">{header(point)}</span>
            )}
            <div className="flex items-baseline justify-between gap-4">
              <span className="type-caption text-chart-tooltip-muted">
                {valueLabel}
              </span>
              <span className="numeric-sm">{formatMoneyExact(cents)}</span>
            </div>
            {layers ? (
              <>
                <div className="my-0.5 h-px bg-chart-grid" aria-hidden />
                {LAYERS.map(({ key, label }) => (
                  <div
                    key={key}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span className="type-caption text-chart-tooltip-muted">
                      {label}
                    </span>
                    <span className="numeric-sm">
                      {formatMoneyExact(layers[key])}
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <span className="type-caption text-chart-tooltip-muted">
                Uncosted — not in margin maths
              </span>
            )}
            {extras.length > 0 && (
              <>
                <div className="my-0.5 h-px bg-chart-grid" aria-hidden />
                {extras.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span className="type-caption text-chart-tooltip-muted">
                      {row.label}
                    </span>
                    <span
                      className={
                        row.struck ? "numeric-sm line-through opacity-60" : "numeric-sm"
                      }
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      }}
    />
  );
}
