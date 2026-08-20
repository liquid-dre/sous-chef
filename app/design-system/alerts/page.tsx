"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertsScreen,
  type AlertsScreenData,
  type SeverityFilter,
} from "@/components/alerts/alerts-screen";
import { RunwayGauge } from "@/components/alerts/runway-gauge";
import type { PantryTrust } from "@/convex/lib/alerts";

/**
 * Alerts specimen — the grading surface for this slice.
 *
 * The four trust states are the point. "Two wrong reds and she mutes the
 * system forever" (CONTEXT.md) is the sentence this whole slice is built
 * against, and the only way to review that is to see the SAME shortfall
 * rendered at each level of confidence: red when the pantry was counted
 * today, amber the moment it was not, and gone entirely once two counts have
 * been missed.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 5);

const RUNWAYS = [
  { ingredientId: "milk", name: "Milk", baseUnit: "ml" as const, onHandMilli: 2_000_000, bookedMilli: 8_000_000, daysOfCover: 1, severity: "red" as const, muted: false },
  { ingredientId: "butter", name: "Butter", baseUnit: "g" as const, onHandMilli: 1_200_000, bookedMilli: 900_000, daysOfCover: 5, severity: "amber" as const, muted: false },
  { ingredientId: "flour", name: "Flour", baseUnit: "g" as const, onHandMilli: 12_000_000, bookedMilli: 2_000_000, daysOfCover: 12, severity: null, muted: false },
  { ingredientId: "sugar", name: "Sugar", baseUnit: "g" as const, onHandMilli: 9_000_000, bookedMilli: 1_000_000, daysOfCover: 21, severity: null, muted: true },
];

const OPEN = [
  {
    subjectKey: "ingredient:milk",
    subjectId: "milk",
    type: "stockShort",
    severity: "red" as const,
    name: "Milk",
    baseUnit: "ml" as const,
    shortfallMilli: 6_000_000,
    staleDays: null,
    runway: { onHandMilli: 2_000_000, bookedMilli: 8_000_000, daysOfCover: 1 },
  },
  {
    subjectKey: "ingredient:butter",
    subjectId: "butter",
    type: "stockShort",
    severity: "amber" as const,
    name: "Butter",
    baseUnit: "g" as const,
    shortfallMilli: 0,
    staleDays: null,
    runway: { onHandMilli: 1_200_000, bookedMilli: 900_000, daysOfCover: 5 },
  },
];

const BASE: AlertsScreenData = {
  open: OPEN,
  suppressed: [{ subjectKey: "ingredient:cocoa", name: "Cocoa" }],
  resolved: [
    {
      id: "a1",
      severity: "red",
      message:
        "2 orders before 2026-08-04 need 3 batches. That wants 4 kg of cocoa and you have 900 g.",
      resolvedAt: NOW - 2 * DAY,
    },
  ],
  runways: RUNWAYS,
  trust: "trusted",
  daysSinceCount: 0,
  orderCount: 3,
  demandBatches: 4,
  horizonEnd: "2026-08-11",
  horizonDays: 7,
  globallyMuted: false,
  mutedIngredients: [{ id: "sugar", name: "Sugar" }],
  counts: { red: 1, amber: 1 },
};

/** The same shortfall, at each level of confidence. */
const STATES: Record<string, AlertsScreenData> = {
  fresh: BASE,
  stale: {
    ...BASE,
    trust: "hedged",
    daysSinceCount: 11,
    // Red demotes; the demand half is untouched.
    open: OPEN.map((a) => ({ ...a, severity: "amber" as const, staleDays: 11 })),
    counts: { red: 0, amber: 2 },
  },
  neverCounted: {
    ...BASE,
    trust: "hedged",
    daysSinceCount: null,
    open: OPEN.map((a) => ({ ...a, severity: "amber" as const, staleDays: null })),
    counts: { red: 0, amber: 2 },
  },
  dormant: {
    ...BASE,
    trust: "dormant" as PantryTrust,
    daysSinceCount: 19,
    open: [],
    counts: { red: 0, amber: 0 },
  },
  muted: { ...BASE, globallyMuted: true, open: [], counts: { red: 0, amber: 0 } },
  empty: {
    ...BASE,
    open: [],
    suppressed: [],
    resolved: [],
    counts: { red: 0, amber: 0 },
  },
};

type StateKey = keyof typeof STATES;

export default function AlertsSpecimenPage() {
  const [state, setState] = React.useState<StateKey>("fresh");
  const [filter, setFilter] = React.useState<SeverityFilter>("all");
  const data = STATES[state];

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Alerts specimen — sample data, saves are pretend
        </p>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3">
          {/* Six states do not fit a phone, so the strip scrolls in its own
              container and the page body never scrolls sideways.
              `min-w-0` is load-bearing: a flex item defaults to
              `min-width: auto`, so without it the wrapper grows to its
              content and `overflow-x-auto` has nothing left to constrain. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Tabs value={state} onValueChange={(v) => setState(v as StateKey)}>
            <TabsList>
              <TabsTrigger value="fresh">Counted today</TabsTrigger>
              <TabsTrigger value="stale">11 days old</TabsTrigger>
              <TabsTrigger value="neverCounted">Never counted</TabsTrigger>
              <TabsTrigger value="dormant">Dormant</TabsTrigger>
              <TabsTrigger value="muted">Muted</TabsTrigger>
              <TabsTrigger value="empty">All clear</TabsTrigger>
            </TabsList>
            </Tabs>
          </div>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 md:px-6 md:py-12">
        <p className="type-caption text-pretty text-muted-foreground">
          The same shortfall in every tab. Red survives only a pantry counted
          today; anything else demotes it to amber with the age stated inline,
          and two missed counts replace the list with one line. The demand half
          of every sentence — what her orders need — never hedges.
        </p>

        <AlertsScreen
          data={data}
          filter={filter}
          onFilterChange={setFilter}
          onResolve={() => {}}
          onUnresolve={() => {}}
          onMuteIngredient={() => {}}
          onUnmuteIngredient={() => {}}
          onGlobalMute={() => {}}
          stocktakeHref="/kitchen-a/pantry/stocktake"
        />

        <section className="flex flex-col gap-4">
          <h2 className="type-display-sm">The gauge, on its own</h2>
          <p className="type-caption text-pretty text-muted-foreground">
            The only gauge in Sous. Gauges are poor for comparison and fine for
            one focal number, so it appears inside a single alert and nowhere
            else — the comparison view is the bar chart above.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <RunwayGauge
              name="Milk"
              baseUnit="ml"
              daysOfCover={1}
              onHandMilli={2_000_000}
              bookedMilli={8_000_000}
              severity="red"
              trust="trusted"
              daysSinceCount={0}
              inHerWords="1.5 batches of Custard"
            />
            <RunwayGauge
              name="Flour"
              baseUnit="g"
              daysOfCover={12}
              onHandMilli={12_000_000}
              bookedMilli={2_000_000}
              severity={null}
              trust={data.trust}
              daysSinceCount={data.daysSinceCount}
              inHerWords="35 brownies"
            />
          </div>
        </section>
      </main>
    </div>
  );
}
