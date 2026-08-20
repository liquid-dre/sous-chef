"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarScreen } from "@/components/calendar/calendar-screen";
import { CapacityBars } from "@/components/calendar/capacity-bars";
import { OrderDensityHeatmap } from "@/components/calendar/order-density-heatmap";
import type { CalendarData } from "@/components/calendar/types";
import { shiftDay, type CalendarView } from "@/convex/lib/schedule";

/**
 * Calendar specimen — the grading surface for this slice.
 *
 * The staff tab is the one that matters. This is the screen staff LAND on,
 * and `capacity` is absent from their payload entirely rather than nulled —
 * so the staff tab here is built from a genuinely different object shape, not
 * from the owner's with a flag flipped. If a cost ever appears on it, it will
 * appear here first.
 */

const TODAY = "2026-08-05"; // a Wednesday
const MONDAY = "2026-08-03";

const DUE = [
  {
    orderId: "o1",
    who: "Tariro Moyo",
    deliveryDay: "2026-08-06",
    summary: "24 × Brownies",
    status: "confirmed" as const,
  },
  {
    orderId: "o2",
    who: "Rudo",
    deliveryDay: "2026-08-06",
    summary: "12 × Brownies",
    status: "confirmed" as const,
  },
  {
    orderId: "o3",
    who: "Walk-in",
    deliveryDay: "2026-08-08",
    summary: "1 × Celebration cake",
    status: "confirmed" as const,
  },
];

const PROMPTS = [
  {
    menuItemId: "brownie",
    itemName: "Brownies",
    startDay: "2026-08-05",
    firstDeliveryDay: "2026-08-06",
    lastDeliveryDay: "2026-08-06",
    qtyMilli: 36_000,
    batchCount: 3,
    batchProductionMinutes: 60,
    overdue: false,
    covers: [
      { orderId: "o1", who: "Tariro Moyo", deliveryDay: "2026-08-06", qtyMilli: 24_000 },
      { orderId: "o2", who: "Rudo", deliveryDay: "2026-08-06", qtyMilli: 12_000 },
    ],
  },
  {
    menuItemId: "cake",
    itemName: "Celebration cake",
    startDay: "2026-08-06",
    firstDeliveryDay: "2026-08-08",
    lastDeliveryDay: "2026-08-08",
    qtyMilli: 1_000,
    batchCount: 1,
    batchProductionMinutes: 480,
    overdue: false,
    covers: [
      { orderId: "o3", who: "Walk-in", deliveryDay: "2026-08-08", qtyMilli: 1_000 },
    ],
  },
];

const OWNER: CalendarData = {
  start: MONDAY,
  end: "2026-08-09",
  today: TODAY,
  due: DUE,
  prompts: PROMPTS,
  stocktakeDays: [TODAY],
  capacity: {
    ceilingHours: 8,
    byDay: [
      { day: "2026-08-05", hours: 3, over: false },
      { day: "2026-08-06", hours: 8, over: false },
    ],
  },
};

/** The staff shape: `capacity` genuinely absent, not null. */
const STAFF: CalendarData = {
  start: MONDAY,
  end: "2026-08-09",
  today: TODAY,
  due: DUE,
  prompts: PROMPTS,
  stocktakeDays: [TODAY],
};

const OVER: CalendarData = {
  ...OWNER,
  prompts: [
    { ...PROMPTS[0], batchCount: 6, qtyMilli: 72_000 },
    { ...PROMPTS[1], startDay: "2026-08-05", batchProductionMinutes: 480 },
  ],
  capacity: {
    ceilingHours: 8,
    byDay: [
      { day: "2026-08-05", hours: 14, over: true },
      { day: "2026-08-06", hours: 2, over: false },
    ],
  },
};

const OVERDUE: CalendarData = {
  ...OWNER,
  prompts: [{ ...PROMPTS[0], startDay: "2026-08-03", overdue: true }],
};

const EMPTY: CalendarData = {
  start: MONDAY,
  end: "2026-08-09",
  today: TODAY,
  due: [],
  prompts: [],
  stocktakeDays: [],
  capacity: { ceilingHours: 8, byDay: [] },
};

const STATES: Record<string, { data: CalendarData; owner: boolean }> = {
  owner: { data: OWNER, owner: true },
  staff: { data: STAFF, owner: false },
  over: { data: OVER, owner: true },
  overdue: { data: OVERDUE, owner: true },
  empty: { data: EMPTY, owner: true },
};

type StateKey = keyof typeof STATES;

/** Twelve weeks of made-up rhythm: Fridays heavy, Tuesdays dead. */
const DENSITY = Array.from({ length: 12 }, (_, w) => ({
  bin: w,
  bins: Array.from({ length: 7 }, (_, d) => ({
    bin: d,
    day: shiftDay("2026-05-18", w * 7 + d),
    count: d === 4 ? 3 + (w % 3) : d === 1 ? 0 : (w + d) % 3,
  })),
}));

export default function CalendarSpecimenPage() {
  const [key, setKey] = React.useState<StateKey>("owner");
  const [view, setView] = React.useState<CalendarView>("week");
  const [anchor, setAnchor] = React.useState(TODAY);
  const state = STATES[key];

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Calendar specimen — sample data, nothing saves
        </p>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 md:w-auto">
          {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto,
              so without it the wrapper grows to its content and
              overflow-x-auto has nothing left to constrain. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Tabs value={key} onValueChange={(v) => setKey(v as StateKey)}>
              <TabsList>
                <TabsTrigger value="owner">Owner</TabsTrigger>
                <TabsTrigger value="staff">Staff</TabsTrigger>
                <TabsTrigger value="over">Over capacity</TabsTrigger>
                <TabsTrigger value="overdue">Overdue start</TabsTrigger>
                <TabsTrigger value="empty">Empty</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 md:px-6 md:py-12">
        <p className="type-caption text-pretty text-muted-foreground">
          Narrow the window and this becomes an agenda; widen it and the month
          grid appears with the day detail beside it. The staff tab is a
          different payload shape, not a filtered one — capacity is absent from
          it, so nothing on that tab can leak a cost.
        </p>

        <CalendarScreen
          data={state.data}
          orgSlug="kitchen-a"
          view={view}
          anchorDay={anchor}
          onViewChange={setView}
          onAnchorChange={setAnchor}
          isOwner={state.owner}
          charts={
            state.owner ? (
              <div className="flex flex-col gap-4">
                {state.data.capacity && state.data.capacity.byDay.length > 0 && (
                  <CapacityBars
                    byDay={state.data.capacity.byDay}
                    ceilingHours={state.data.capacity.ceilingHours}
                  />
                )}
                <OrderDensityHeatmap columns={DENSITY} orderCount={96} />
              </div>
            ) : null
          }
        />
      </main>
    </div>
  );
}
