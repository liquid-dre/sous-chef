"use client";

import { ShoppingBasket } from "lucide-react";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ReferenceArea } from "@/components/charts/reference-area";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { CostTooltip, type CostLayers } from "@/components/charts-sous/cost-tooltip";
import { formatMoneyExact } from "@/components/charts-sous/format";
import type { Optimisation, YieldOption } from "@/convex/lib/optimiser";

/**
 * The solution surface: what margin each yield reaches at her current price.
 *
 * A bar per yield, not a curve. Two reasons, one practical and one honest.
 * Practical: every Bklit cartesian chart is built on a time X scale, so a
 * units-per-batch axis has nowhere to go — BarChart's scaleBand is the only
 * one that renders "10, 11, 12" as itself. Honest: you cannot cut a tray into
 * 12.4 pieces, and a bar can carry four states a line cannot — reaches
 * target, short of it, ruled out by one of her limits, and where she is now.
 *
 * Per-bar colour comes from three stacked series with one non-zero key per
 * row, because Bar.fill is a single string rather than a function. This is the
 * technique the pantry drift chart already uses.
 *
 * State is never carried by colour alone (DESIGN.md §4): the current yield is
 * marked in its own axis label, and a ruled-out yield is marked in its label
 * too, so both survive a greyscale screenshot and colourblind vision.
 */

/**
 * 200ms, not the 260 used elsewhere: Bar spreads its stagger over a further
 * 40% of the duration, so the last bar lands at duration × 1.4. At 260 that
 * is 364ms and past DESIGN.md's 300ms ceiling; at 200 the whole surface has
 * settled in 280ms.
 */
const DURATION = 200;
/** Half a percentage point either side, drawn as a band because the library
 * has no ReferenceLine — the same degenerate-area trick the pantry uses for
 * its zero rule. */
const RULE_HALF_HEIGHT = 0.35;

interface Row extends Record<string, unknown> {
  name: string;
  reaches: number;
  short: number;
  ruledOut: number;
  // Three more degenerate series, for the same reason as the first three:
  // `Bar.fill` is a string and not a function, so a per-bar tone can only be
  // had by giving each tone its own series and zeroing the rest. Complaints
  // are orthogonal to the three margin states, so each state needs a
  // complained twin rather than a fourth state.
  reachesComplained: number;
  shortComplained: number;
  ruledOutComplained: number;
  /** The tooltip's headline value, in cents. */
  variableCentsPerUnit: number;
  costLayers: CostLayers;
  option: YieldOption;
}

/**
 * Marks COMPOSE rather than branch.
 *
 * The old form returned early, so a yield that was both current and ruled out
 * read "12 now" and silently lost its ✕. With a third mark that swallowing
 * gets worse — the size she is on is the most likely one to have drawn
 * complaints, and it is the one whose mark must not disappear.
 *
 * Every mark is shape, not colour: they survive a greyscale screenshot and
 * colourblind vision, which is why the state is never carried by the bar tone
 * alone (DESIGN.md §4).
 */
function label(option: YieldOption, complained: boolean): string {
  const marks = [
    option.isCurrent ? "now" : null,
    option.blocked ? "✕" : null,
    complained ? "⚠" : null,
  ].filter(Boolean);
  return marks.length > 0
    ? `${option.yieldUnits} ${marks.join(" ")}`
    : String(option.yieldUnits);
}

export function SolutionSurfaceChart({
  optimisation,
  targetPercent,
  complainedYields = [],
}: {
  optimisation: Optimisation;
  /** Drawn as the rule. Null when she has not set one — then there is no
   * rule to draw, and the bars are just the shape of the trade. */
  targetPercent: number | null;
  /**
   * Sizes customers actually called too small. NOT a range: a shaded band
   * would implicate every yield inside it, including cuts nobody has ever
   * been served, and at these sample sizes that is a claim about food that
   * was never made.
   *
   * A vertical `ReferenceArea` was the obvious alternative and it is not
   * available — `BarChart` publishes a non-callable fake xScale
   * (`bar-chart.tsx:357`), so passing x1/x2 throws.
   */
  complainedYields?: number[];
}) {
  const { options, priceCents, verdict } = optimisation;
  const awaitingInput = verdict.kind === "noCost" || priceCents == null;

  const complained = new Set(complainedYields);
  const rows: Row[] = options.map((option) => {
    // Margins can go negative; bars render magnitudes, so a negative margin
    // is clamped to zero here and stated exactly in the tooltip instead of
    // being drawn upside down.
    const margin = Math.max(0, option.grossMarginExact ?? 0);
    const flagged = complained.has(option.yieldUnits);
    const reaches = !option.blocked && option.reachesTarget;
    const short = !option.blocked && !option.reachesTarget;
    return {
      name: label(option, flagged),
      reaches: reaches && !flagged ? margin : 0,
      short: short && !flagged ? margin : 0,
      ruledOut: option.blocked && !flagged ? margin : 0,
      reachesComplained: reaches && flagged ? margin : 0,
      shortComplained: short && flagged ? margin : 0,
      ruledOutComplained: option.blocked && flagged ? margin : 0,
      variableCentsPerUnit: option.variableCentsPerUnit,
      costLayers: {
        ingredientsCents: option.ingredientsCentsPerUnit,
        perUnitExtrasCents: option.extrasCentsPerUnit,
        overheadCents: option.overheadCentsPerUnit,
      },
      option,
    };
  });

  return (
    <SousChart
      title="What each yield reaches"
      // The price belongs in the caption, not beside the title: competing for
      // the header at 380px truncated the title to "What each yield reac…".
      state={awaitingInput ? "awaitingInput" : "ready"}
      emptyIcon={ShoppingBasket}
      emptyTitle={
        verdict.kind === "noCost" ? "Nothing costed yet" : "No price yet"
      }
      emptyBody={
        verdict.kind === "noCost"
          ? "Add what goes into this and the margin at each yield appears here."
          : "Set what you charge and the margin at each yield appears here."
      }
      scrollMinWidth={rows.length > 8 ? 380 : undefined}
      caption={
        // Outside the scroller: the key names each state in words, so the
        // bars never depend on colour to be read, and it must not slide out
        // of view when the plot scrolls on a phone.
        !awaitingInput ? (
          <p className="type-caption text-center text-muted-foreground">
            Gross margin at {formatMoneyExact(priceCents!)} each.
            {targetPercent != null
              ? " Bars reaching the rule hit your target;"
              : " Taller bars keep more of each sale;"}{" "}
            <span className="whitespace-nowrap">✕ marks a yield</span> one of
            your limits rules out
            {complainedYields.length > 0 ? (
              <>
                ,{" "}
                {/* ReferenceArea has no label prop, so the key lives here —
                    which is where every other chart in Sous puts it. */}
                <span className="whitespace-nowrap">⚠ a size</span> customers
                called too small
              </>
            ) : null}
            .
          </p>
        ) : undefined
      }
    >
      <BarChart
        data={rows}
        stacked
        animationDuration={DURATION}
        aspectRatio="2 / 1.3"
        margin={{ top: 16, right: 12, bottom: 28, left: 44 }}
      >
        {targetPercent != null && (
          <ReferenceArea
            y1={targetPercent - RULE_HALF_HEIGHT}
            y2={targetPercent + RULE_HALF_HEIGHT}
            fill="var(--chart-target)"
            fillOpacity={1}
            // Semantic, never palette-derived: a kitchen whose brand colour is
            // red must not have its target render as brand chrome.
            stroke="var(--chart-target)"
            // The rule sits outside the bars' own domain whenever no yield
            // reaches target, which is exactly when she most needs to see it.
            ifOverflow="visible"
          />
        )}
        <Bar dataKey="reaches" fill="var(--chart-profit)" />
        <Bar dataKey="short" fill="var(--chart-1)" />
        <Bar dataKey="ruledOut" fill="var(--chart-foreground-muted)" />
        {/* The complained twins. Amber is the semantic warn token, never
            derived from her palette — a size customers called too small is a
            warning, not brand chrome (DESIGN.md §5). The ⚠ in the axis label
            carries the same fact without colour. */}
        <Bar dataKey="reachesComplained" fill="var(--chart-warn)" />
        <Bar dataKey="shortComplained" fill="var(--chart-warn)" />
        <Bar dataKey="ruledOutComplained" fill="var(--chart-warn)" />
        <BarXAxis showAllLabels />
        {/* The cartesian YAxis, not BarYAxis: on a vertical bar chart
            BarYAxis draws the CATEGORY labels, and this library ships no
            numeric axis for bars. BarChart publishes the same chart context,
            whose yScale is the value scale when orientation is vertical, so
            YAxis reads it correctly and brings formatValue with it. */}
        <YAxis numTicks={4} formatValue={(v) => `${Math.round(v)}%`} />
        <CostTooltip
          valueKey="variableCentsPerUnit"
          valueLabel="Costs a unit"
          header={(point) => {
            const o = (point as Row).option;
            return `${o.yieldUnits} a tray${o.isCurrent ? " — where you are" : ""}`;
          }}
          extraRows={(point) => {
            const o = (point as Row).option;
            const rows: { label: string; value: string; struck?: boolean }[] = [
              { label: "Each one weighs", value: `${Math.round(o.unitWeightMilligrams / 1000)} g` },
            ];
            if (o.grossMarginExact != null) {
              // One decimal where rounding and the reach flag disagree — at
              // yield 19 the bar reads 65% and does not reach 65%, and
              // without the decimal that looks like a bug rather than
              // rounding.
              const rounded = o.grossMarginPercent!;
              const disagrees =
                targetPercent != null &&
                !o.reachesTarget &&
                rounded >= targetPercent;
              rows.push({
                label: "Gross",
                value: disagrees
                  ? `${o.grossMarginExact.toFixed(1)}%`
                  : `${rounded}%`,
              });
              rows.push({ label: "Net", value: `${o.netMarginPercent}%` });
            }
            if (targetPercent != null && o.priceToReachTargetCents != null) {
              rows.push({
                label: `${targetPercent}% here would need`,
                value: formatMoneyExact(o.priceToReachTargetCents),
                struck: o.blocks.some(
                  (b) => b.kind === "maxPrice" && b.severity === "blocking",
                ),
              });
            }
            return rows;
          }}
        />
      </BarChart>
    </SousChart>
  );
}
