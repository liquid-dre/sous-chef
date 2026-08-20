"use client";

import { Gauge } from "@/components/charts/gauge";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { StaleChartFrame, staleFill } from "./stale-chart";
import { formatQty, type BaseUnit } from "@/components/pantry/format";
import { HORIZON_DAYS, type PantryTrust } from "@/convex/lib/alerts";

/**
 * One ingredient's runway, and the ONLY gauge in Sous.
 *
 * DESIGN.md's charting rules are about comparison, and a gauge is bad at it —
 * two gauges side by side are two arcs the eye cannot subtract. That is
 * exactly why it belongs here and nowhere else: inside one alert there is one
 * focal number, no comparison to make, and the arc reads as a fuel level,
 * which is what a runway is. The comparison view is the horizontal bar chart
 * on the screen behind this.
 *
 * Two constraints from the vendored component (`components/charts/gauge.tsx`),
 * both worked around rather than fought:
 *
 * - **`value` is 0–100 with no domain prop.** So the days are normalised
 *   against a two-week ceiling before they are handed over, and the ceiling
 *   is stated in the caption so the arc is never a number without a scale.
 * - **`centerValue` is a SEPARATE number** from the fill, which is the whole
 *   reason this works: the arc shows the proportion and the label shows the
 *   days, so she reads "4 days" rather than "29%".
 */

/** Two weeks. Longer than her weekly shop and her weekly count, so a full
 * arc means "this is not the thing to worry about" rather than an
 * unreachable ideal. Anything beyond it pins at full. */
const CEILING_DAYS = 14;

/**
 * NOT VERIFIED VISUALLY, and the reason is worth writing down.
 *
 * `Gauge` sizes itself through `<ParentSize>` (gauge.tsx:721), which is
 * driven by a `ResizeObserver`. **ResizeObserver never fires in the in-app
 * browser pane** — measured directly against `document.body` at 885×2003,
 * zero callbacks — so the arc renders as an empty box there. The pre-existing
 * gauge on `app/design-system/charts` behaves identically, which is what
 * rules the component out as the cause.
 *
 * The component does expose an escape hatch (pass both `width` and `height`
 * and it skips `ParentSize` entirely, gauge.tsx:701), but any measurement WE
 * did would go through the same `ResizeObserver`, so it buys nothing. This
 * therefore matches `app/design-system/charts/page.tsx:491` exactly rather
 * than inventing machinery around a limitation that is not the app's.
 *
 * Everything around the arc — the figures, the caption, the empty state, the
 * stale badge — is plain DOM and IS verified.
 */

export function RunwayGauge({
  name,
  baseUnit,
  daysOfCover,
  onHandMilli,
  bookedMilli,
  severity,
  trust,
  daysSinceCount,
  /** Her phrase for what is left — "1.5 batches of Custard", "35 brownies".
   * Optional because it needs a menu item to be expressed against, and an
   * ingredient used by nothing has none. */
  inHerWords,
}: {
  name: string;
  baseUnit: BaseUnit;
  daysOfCover: number | null;
  onHandMilli: number;
  bookedMilli: number;
  severity: "red" | "amber" | null;
  trust: PantryTrust;
  daysSinceCount: number | null;
  inHerWords?: string | null;
}) {
  const stale = trust !== "trusted";
  const known = daysOfCover !== null;
  const days = daysOfCover ?? 0;
  const percent = Math.max(0, Math.min(100, Math.round((days / CEILING_DAYS) * 100)));

  const token =
    severity === "red"
      ? "var(--chart-loss)"
      : severity === "amber"
        ? "var(--chart-warn)"
        : "var(--chart-1)";

  return (
    <SousChart
      title={`${name} runway`}
      // Not a sample size — a gauge rests on one figure, and printing "n = 1"
      // beside it would be a claim about evidence it is not making.
      state={known ? "ready" : "empty"}
      emptyTitle="No runway to show"
      emptyBody={`Nothing booked needs ${name.toLowerCase()} this week, and there is no history yet to judge it by.`}
      caption={
        <p className="type-caption text-center text-pretty text-muted-foreground">
          <span className="numeric">{formatQty(onHandMilli, baseUnit)}</span> on
          hand
          {bookedMilli > 0 && (
            <>
              , and your orders need{" "}
              <span className="numeric">{formatQty(bookedMilli, baseUnit)}</span>
            </>
          )}
          {inHerWords ? ` — ${inHerWords}.` : "."}{" "}
          The arc fills to <span className="numeric">{CEILING_DAYS}</span> days.
        </p>
      }
    >
      <StaleChartFrame stale={stale} daysSinceCount={daysSinceCount}>
        <Gauge
          value={percent}
          // The DAYS, not the percentage. The arc carries the proportion; the
          // label has to carry the thing she can act on.
          centerValue={days}
          suffix={days === 1 ? " day" : " days"}
          defaultLabel={
            bookedMilli > 0
              ? `covers your next ${HORIZON_DAYS} days?`
              : "of a normal week"
          }
          activeFill={staleFill(token, stale)}
          totalNotches={40}
          // 260ms, and the arc is drawn once when the alert opens — not a
          // thing she sees dozens of times a day (DESIGN.md §6).
          enterTransition={{ type: "tween", duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
        />
      </StaleChartFrame>
    </SousChart>
  );
}
