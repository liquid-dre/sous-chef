"use client";

import { ShoppingBasket, TrendingUp } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { LineChart } from "@/components/charts/line-chart";
import { Line } from "@/components/charts/line";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ReferenceArea } from "@/components/charts/reference-area";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { formatMoneyExact } from "@/components/charts-sous/format";
import { formatUnitPrice, type BaseUnit } from "./format";

/**
 * Both charts plot % difference from standard cost, never absolute money.
 * Zero therefore MEANS something — "exactly on standard cost" — so the axis
 * is honestly zero-anchored rather than truncated (DESIGN.md §5), and the
 * drift occupies the full height instead of four pixels near the top.
 * Exact money lives in the tooltip, which never abbreviates.
 */

/**
 * 200, not 260: Bar spreads its stagger over a further 40% of the duration,
 * so the last bar lands at duration × 1.4. At 260 that is 364ms and past
 * DESIGN.md §6's 300ms ceiling; at 200 the whole chart has settled in 280ms.
 * The line chart below does not stagger, but shares the constant — 200 is
 * --duration-base, so it costs nothing to keep one number in this file.
 */
const DURATION = 200;

export interface HistoryPoint {
  purchasedAt: number;
  unitPriceCentsPerThousand: number;
  percentFromStandard: number;
  priceCents: number;
}

/** Ingredient detail: how this one price has moved against what she costs at. */
export function PriceHistoryChart({
  name,
  baseUnit,
  standardCentsPerThousand,
  history,
}: {
  name: string;
  baseUnit: BaseUnit;
  standardCentsPerThousand: number;
  history: HistoryPoint[];
}) {
  const points = history.map((h) => ({
    date: new Date(h.purchasedAt),
    percentFromStandard: h.percentFromStandard,
    unitPrice: h.unitPriceCentsPerThousand,
  }));

  const state =
    points.length === 0 ? "empty" : points.length === 1 ? "single" : "ready";

  return (
    <SousChart
      title="Price history"
      sampleSize={history.length}
      sampleNoun="purchases"
      state={state}
      emptyIcon={TrendingUp}
      emptyTitle="No purchases recorded yet"
      emptyBody={`Log a shop and ${name}'s prices start plotting against your standard cost.`}
      singleValue={
        history[0]
          ? formatUnitPrice(history[0].unitPriceCentsPerThousand, baseUnit)
          : undefined
      }
      singleLabel="The one price recorded so far"
    >
      <LineChart
        data={points}
        xDataKey="date"
        animationDuration={DURATION}
        yDomainTween={false}
        aspectRatio="2 / 1"
        margin={{ top: 16, right: 12, bottom: 28, left: 52 }}
      >
        <Grid horizontal />
        {/* The reference line: zero is the standard cost she costs against. */}
        <ReferenceArea
          y1={-0.35}
          y2={0.35}
          fill="var(--chart-target)"
          fillOpacity={1}
        />
        <Line dataKey="percentFromStandard" stroke="var(--chart-1)" />
        <XAxis numTicks={5} />
        <YAxis formatValue={(v) => `${Math.round(v as number)}%`} />
        <ChartTooltip
          rows={(point) => [
            {
              color: "var(--chart-1)",
              label: "Paid",
              value: formatUnitPrice(point.unitPrice as number, baseUnit),
            },
            {
              color: "var(--chart-target)",
              label: "Standard",
              value: formatUnitPrice(standardCentsPerThousand, baseUnit),
            },
          ]}
        />
      </LineChart>
      <p className="type-caption text-center text-muted-foreground">
        0% is your standard cost of{" "}
        <span className="numeric">
          {formatUnitPrice(standardCentsPerThousand, baseUnit)}
        </span>
        . The gap is the drift.
      </p>
    </SousChart>
  );
}

export interface DriftBarRow {
  name: string;
  percent: number;
  severity: "none" | "amber" | "red";
}

/**
 * Pantry-wide: what has moved on her, sorted by magnitude. Diverging around
 * zero as a paired series, because Bklit bars render magnitudes rather than
 * signed values — up (dearer) is the warning colour, down (cheaper) is not.
 */
export function PantryDriftChart({
  rows,
  anyDriftComputable,
}: {
  rows: DriftBarRow[];
  anyDriftComputable: boolean;
}) {
  const sorted = [...rows]
    .filter((r) => r.percent !== 0)
    .sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent))
    .slice(0, 12)
    .map((r) => ({
      // Direction is shape-encoded, never colour alone — the same reasoning
      // that puts negative money in parentheses (DESIGN.md §4). A caret
      // costs two characters, so labels survive the axis width; the exact
      // signed figure is in the tooltip.
      name: `${r.percent > 0 ? "▲" : "▼"} ${r.name}`,
      dearer: r.percent > 0 ? r.percent : 0,
      cheaper: r.percent < 0 ? Math.abs(r.percent) : 0,
      percent: r.percent,
    }));

  return (
    <SousChart
      title="What has moved"
      sampleSize={rows.length}
      sampleNoun="ingredients priced"
      state={!anyDriftComputable || sorted.length === 0 ? "empty" : "ready"}
      emptyIcon={ShoppingBasket}
      emptyTitle={
        anyDriftComputable
          ? "Nothing has moved"
          : "Not enough purchases to compare yet"
      }
      emptyBody={
        anyDriftComputable
          ? "Every ingredient is sitting on the cost you set for it."
          : "Sous compares the middle of your last three prices for an ingredient, so it needs three of them before it can show drift."
      }
    >
      <BarChart
        data={sorted}
        orientation="horizontal"
        animationDuration={DURATION}
        stacked
        aspectRatio="2 / 1.4"
      >
        <Bar dataKey="dearer" fill="var(--chart-warn)" />
        <Bar dataKey="cheaper" fill="var(--chart-profit)" />
        <BarYAxis />
        <ChartTooltip
          rows={(point) => [
            {
              color:
                (point.percent as number) > 0
                  ? "var(--chart-warn)"
                  : "var(--chart-profit)",
              label: String(point.name),
              value: `${(point.percent as number) > 0 ? "+" : ""}${point.percent}%`,
            },
          ]}
        />
      </BarChart>
      <p className="type-caption text-center text-muted-foreground">
        Difference between your standard cost and the middle of your last
        three prices. ▲ dearer, ▼ cheaper; longer bars have moved further.
      </p>
    </SousChart>
  );
}

export { formatMoneyExact };
