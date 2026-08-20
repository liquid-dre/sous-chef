"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ProductionForm,
  type NeedsMakingRow,
} from "@/components/production/production-form";
import {
  MadeVersusSoldChart,
  WasteRateChart,
  YieldVarianceChart,
  type MadeVsSoldRow,
  type VariancePoint,
  type WastePoint,
} from "@/components/production/leak-charts";
import { parseDay } from "@/lib/day";

/**
 * Production specimen — the grading surface. The real form and the real
 * charts against sample data, so the whole slice is reviewable without a
 * session, including the states that only appear once there is history.
 */

const ROWS: NeedsMakingRow[] = [
  {
    menuItemId: "brownie",
    name: "Brownies",
    baseBatchYield: 12,
    shelfLifeHours: 72,
    neededMilli: 6_000,
    suggestedBatchCount: 1,
    orders: [
      { id: "o1", who: "Tariro Moyo", deliveryDate: "2026-08-06", qtyMilli: 4_000 },
      { id: "o2", who: "Rudo Chikafu", deliveryDate: "2026-08-08", qtyMilli: 2_000 },
    ],
  },
  {
    menuItemId: "sourdough",
    name: "Sourdough loaf",
    baseBatchYield: 4,
    shelfLifeHours: 48,
    neededMilli: 3_000,
    suggestedBatchCount: 1,
    orders: [
      { id: "o3", who: "Tanaka Ncube", deliveryDate: "2026-08-05", qtyMilli: 3_000 },
    ],
  },
  {
    menuItemId: "scones",
    name: "Scones",
    baseBatchYield: 20,
    shelfLifeHours: 24,
    neededMilli: 0,
    suggestedBatchCount: 1,
    orders: [],
  },
];

const MADE_VS_SOLD: MadeVsSoldRow[] = [
  {
    menuItemId: "brownie", name: "Brownies",
    madeMilli: 96_000, soldMilli: 71_000, wastedMilli: 21_000, onHandMilli: 4_000,
    wastePercent: 22, wasteValueCents: 2_226,
  },
  {
    menuItemId: "scones", name: "Scones",
    madeMilli: 120_000, soldMilli: 102_000, wastedMilli: 18_000, onHandMilli: 0,
    wastePercent: 15, wasteValueCents: 1_260,
  },
  {
    menuItemId: "sourdough", name: "Sourdough loaf",
    madeMilli: 32_000, soldMilli: 30_000, wastedMilli: 2_000, onHandMilli: 0,
    wastePercent: 6, wasteValueCents: 384,
  },
];

const DAYS = [
  "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29",
  "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27",
  "2026-08-03",
];
const WASTE = [28, 24, 26, 19, 22, 17, 20, 14, 12];

const WASTE_POINTS: WastePoint[] = DAYS.map((d, i) => ({
  date: parseDay(d),
  wastePercent: WASTE[i],
}));

const VARIANCE: VariancePoint[] = DAYS.map((d, i) => ({
  date: parseDay(d),
  variancePercent: [-17, -8, -25, 0, -12, -8, 8, -4, -8][i],
  name: i % 2 === 0 ? "Brownies" : "Scones",
  expectedUnits: i % 2 === 0 ? 12 : 20,
  actualUnits: i % 2 === 0 ? [10, 11, 9, 12, 11, 11, 13, 12, 11][i] : 18,
}));

const pause = () => new Promise<void>((r) => setTimeout(r, 400));

type View = "form" | "empty" | "charts" | "thin";

export default function ProductionSpecimenPage() {
  const [view, setView] = React.useState<View>("form");

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Production specimen — sample data, saves are pretend
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="min-w-0 max-w-full overflow-x-auto">
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="form">Form</TabsTrigger>
                <TabsTrigger value="empty">Nothing booked</TabsTrigger>
                <TabsTrigger value="charts">The leak</TabsTrigger>
                <TabsTrigger value="thin">Too few batches</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-10">
        {view === "form" && <ProductionForm rows={ROWS} onLog={pause} />}
        {view === "empty" && <ProductionForm rows={[]} onLog={pause} />}
        {view === "charts" && (
          <div className="flex flex-col gap-5">
            <MadeVersusSoldChart rows={MADE_VS_SOLD} />
            <WasteRateChart points={WASTE_POINTS} />
            <YieldVarianceChart points={VARIANCE} />
          </div>
        )}
        {view === "thin" && (
          <div className="flex flex-col gap-5">
            {/* Below eight batches: points shown, no trend drawn. */}
            <YieldVarianceChart points={VARIANCE.slice(0, 3)} />
            <WasteRateChart points={WASTE_POINTS.slice(0, 1)} />
            <MadeVersusSoldChart rows={[]} />
          </div>
        )}
      </main>
    </div>
  );
}
