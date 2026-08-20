"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdoptMedianDialog } from "@/components/pantry/adopt-median-dialog";
import {
  DriftBadge,
  DriftComparison,
  type DriftShape,
} from "@/components/pantry/drift-comparison";
import {
  PantryDriftChart,
  PriceHistoryChart,
} from "@/components/pantry/drift-charts";
import { PurchaseEntryForm } from "@/components/pantry/purchase-entry-form";
import { ConfidenceNote } from "@/components/pantry/confidence-note";
import { StocktakeForm } from "@/components/pantry/stocktake-form";
import { Ledger } from "@/components/pantry/ledger";
import { MovementDialog } from "@/components/pantry/movement-dialogs";
import { SubRecipePrompt } from "@/components/production/sub-recipe-prompt";
import { formatSetAt, formatUnitPrice } from "@/components/pantry/format";

/**
 * Pantry specimen — the grading surface for this slice. Mounts the real
 * components with sample data and no-op saves, so the dense purchase form,
 * both drift charts and every state are reviewable without a session.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 2);

const OPTIONS = [
  { id: "flour", name: "Flour", baseUnit: "g" as const, standardCostCentsPerThousand: 185 },
  { id: "butter", name: "Butter", baseUnit: "g" as const, standardCostCentsPerThousand: 420 },
  { id: "sugar", name: "Sugar", baseUnit: "g" as const, standardCostCentsPerThousand: 150 },
  { id: "cocoa", name: "Cocoa", baseUnit: "g" as const, standardCostCentsPerThousand: 910 },
  { id: "eggs", name: "Eggs", baseUnit: "unit" as const, standardCostCentsPerThousand: 30_000 },
  { id: "milk", name: "Milk", baseUnit: "ml" as const, standardCostCentsPerThousand: 120 },
];

const LAST_SHOP = {
  purchasedAt: NOW - 7 * DAY,
  lineCount: 6,
  totalCents: 370 + 510 + 149 + 520 + 930 + 242,
  lines: [
    { ingredientId: "butter", name: "Butter", baseUnit: "g" as const, packQtyMilli: 1_000, packUnit: "kg" as const, priceCents: 510 },
    { ingredientId: "cocoa", name: "Cocoa", baseUnit: "g" as const, packQtyMilli: 500_000, packUnit: "g" as const, priceCents: 520 },
    { ingredientId: "eggs", name: "Eggs", baseUnit: "unit" as const, packQtyMilli: 30_000, packUnit: "each" as const, priceCents: 930 },
    { ingredientId: "flour", name: "Flour", baseUnit: "g" as const, packQtyMilli: 2_000, packUnit: "kg" as const, priceCents: 370 },
    { ingredientId: "milk", name: "Milk", baseUnit: "ml" as const, packQtyMilli: 2_000, packUnit: "L" as const, priceCents: 242 },
    { ingredientId: "sugar", name: "Sugar", baseUnit: "g" as const, packQtyMilli: 1_000, packUnit: "kg" as const, priceCents: 149 },
  ],
};

const BUTTER_DRIFT: DriftShape = {
  medianCentsPerThousand: 480,
  standardCentsPerThousand: 420,
  percent: 14,
  severity: "amber",
  drifted: true,
  stale: false,
  staleDays: 40,
  purchaseCount: 3,
  hasEnoughData: true,
};

const THIN_DRIFT: DriftShape = {
  medianCentsPerThousand: null,
  standardCentsPerThousand: 185,
  percent: null,
  severity: "none",
  drifted: false,
  stale: false,
  staleDays: 12,
  purchaseCount: 2,
  hasEnoughData: false,
};

const STALE_DRIFT: DriftShape = {
  ...THIN_DRIFT,
  purchaseCount: 0,
  stale: true,
  staleDays: 140,
};

const HISTORY = [
  { purchasedAt: NOW - 21 * DAY, unitPriceCentsPerThousand: 420, percentFromStandard: 0, priceCents: 420 },
  { purchasedAt: NOW - 14 * DAY, unitPriceCentsPerThousand: 480, percentFromStandard: 14, priceCents: 480 },
  { purchasedAt: NOW - 7 * DAY, unitPriceCentsPerThousand: 510, percentFromStandard: 21, priceCents: 510 },
  { purchasedAt: NOW - 1 * DAY, unitPriceCentsPerThousand: 760, percentFromStandard: 81, priceCents: 190 },
];

const DRIFT_ROWS = [
  { name: "Butter", percent: 14, severity: "amber" as const },
  { name: "Cocoa", percent: 24, severity: "red" as const },
  { name: "Eggs", percent: 4, severity: "none" as const },
  { name: "Milk", percent: -3, severity: "none" as const },
  { name: "Sugar", percent: -8, severity: "none" as const },
];

const pause = () => new Promise<void>((r) => setTimeout(r, 400));

/**
 * The four confidence states, which are the grading surface for this slice.
 *
 * All four render the LEVELS — DESIGN.md §4 bans a number whose staleness is
 * unknown, not one whose staleness is stated, and CONTEXT.md is explicit that
 * a dormant pantry still shows its figures and says what they are worth.
 * Fresh renders nothing at all, which is why it is here to be looked at: a
 * reassurance banner on every load is chrome she learns to skip.
 */
const CONFIDENCE = {
  fresh: {
    state: "fresh" as const,
    daysSinceCount: 0,
    daysSincePurchase: 2,
    missedCounts: 0,
    purchaseLoggingStale: false,
    dueToday: false,
  },
  due: {
    state: "fresh" as const,
    daysSinceCount: 7,
    daysSincePurchase: 2,
    missedCounts: 0,
    purchaseLoggingStale: false,
    dueToday: true,
  },
  neverCounted: {
    state: "neverCounted" as const,
    daysSinceCount: null,
    daysSincePurchase: 3,
    missedCounts: 0,
    purchaseLoggingStale: false,
    dueToday: false,
  },
  staleReceipts: {
    state: "stale" as const,
    daysSinceCount: 1,
    daysSincePurchase: 18,
    missedCounts: 0,
    purchaseLoggingStale: true,
    dueToday: false,
  },
  staleCount: {
    state: "stale" as const,
    daysSinceCount: 11,
    daysSincePurchase: 2,
    missedCounts: 1,
    purchaseLoggingStale: false,
    dueToday: false,
  },
  dormant: {
    state: "dormant" as const,
    daysSinceCount: 19,
    daysSincePurchase: 9,
    missedCounts: 2,
    purchaseLoggingStale: false,
    dueToday: false,
  },
};

const STOCKTAKE_ROWS = [
  { id: "flour", name: "Flour", baseUnit: "g" as const, expectedMilli: 2_400_000, countedAt: NOW - 7 * DAY },
  { id: "butter", name: "Butter", baseUnit: "g" as const, expectedMilli: 800_000, countedAt: NOW - 7 * DAY },
  { id: "cocoa", name: "Cocoa", baseUnit: "g" as const, expectedMilli: 340_000, countedAt: null },
  { id: "eggs", name: "Eggs", baseUnit: "unit" as const, expectedMilli: 18_000, countedAt: NOW - 21 * DAY },
  { id: "milk", name: "Milk", baseUnit: "ml" as const, expectedMilli: 3_000_000, countedAt: NOW - 7 * DAY },
];

/** A ledger with the awkward case in it: a receipt entered AFTER the count
 * but dated before it, which is real, is kept, and moves nothing. */
const LEDGER_ROWS = [
  { id: "m6", deltaMilli: -500_000, reason: "production", note: null, occurredAt: NOW - 1 * DAY, runningMilli: 1_900_000, superseded: false, isAnchor: false },
  { id: "m5", deltaMilli: -100_000, reason: "waste", note: "Weevils in the bag", occurredAt: NOW - 2 * DAY, runningMilli: 2_400_000, superseded: false, isAnchor: false },
  { id: "m4", deltaMilli: -600_000, reason: "stocktake", note: null, occurredAt: NOW - 3 * DAY, runningMilli: 2_500_000, superseded: false, isAnchor: true },
  { id: "m3", deltaMilli: 2_000_000, reason: "purchase", note: null, occurredAt: NOW - 4 * DAY, runningMilli: 2_500_000, superseded: true, isAnchor: false },
  { id: "m2", deltaMilli: -500_000, reason: "production", note: null, occurredAt: NOW - 9 * DAY, runningMilli: 2_500_000, superseded: true, isAnchor: false },
  { id: "m1", deltaMilli: 2_000_000, reason: "purchase", note: null, occurredAt: NOW - 11 * DAY, runningMilli: 2_500_000, superseded: true, isAnchor: false },
];

const SUB_SHORTFALLS = [
  {
    subMenuItemId: "buttercream",
    name: "Buttercream",
    neededMilli: 4_000,
    onHandMilli: 1_000,
    shortMilli: 3_000,
    batchesToCover: 1,
  },
];

type DataState = "normal" | "thin" | "none";
type ConfidenceKey = keyof typeof CONFIDENCE;

export default function PantrySpecimenPage() {
  const [state, setState] = React.useState<DataState>("normal");
  const [confidence, setConfidence] = React.useState<ConfidenceKey>("dormant");
  const [declined, setDeclined] = React.useState<string[]>([]);

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Pantry specimen — sample data, saves are pretend
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={state} onValueChange={(v) => setState(v as DataState)}>
            <TabsList>
              <TabsTrigger value="normal">Normal</TabsTrigger>
              <TabsTrigger value="thin">Under 3 purchases</TabsTrigger>
              <TabsTrigger value="none">Nothing yet</TabsTrigger>
            </TabsList>
          </Tabs>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8 md:px-6 md:py-12">
        <section className="flex flex-col gap-4">
          <h2 className="type-display-sm">Purchase entry</h2>
          <PurchaseEntryForm
            options={OPTIONS}
            lastShop={state === "none" ? null : LAST_SHOP}
            onSave={pause}
          />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="type-display-sm">Drift, stated as a comparison</h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className="type-caption text-muted-foreground">Badges:</span>
            <DriftBadge drift={BUTTER_DRIFT} muted={false} />
            <DriftBadge
              drift={{ ...BUTTER_DRIFT, percent: 24, severity: "red" }}
              muted={false}
            />
            <DriftBadge drift={STALE_DRIFT} muted={false} />
            <span className="type-caption text-muted-foreground">
              (a muted or steady ingredient shows nothing at all)
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4 rounded-lg border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="type-title">Butter</h3>
                  <p className="type-caption text-muted-foreground">
                    Costed at{" "}
                    <span className="numeric">{formatUnitPrice(420, "g")}</span>{" "}
                    · {formatSetAt(NOW - 40 * DAY, NOW)}
                  </p>
                </div>
                <AdoptMedianDialog
                  name="Butter"
                  baseUnit="g"
                  standardCentsPerThousand={420}
                  medianCentsPerThousand={480}
                  percent={14}
                  onAdopt={pause}
                />
              </div>
              <DriftComparison
                baseUnit="g"
                standardSetAt={NOW - 40 * DAY}
                drift={
                  state === "normal"
                    ? BUTTER_DRIFT
                    : state === "thin"
                      ? THIN_DRIFT
                      : STALE_DRIFT
                }
                marginNow={state === "normal" ? 68 : undefined}
                marginIfAdopted={state === "normal" ? 64 : undefined}
                targetPercent={state === "normal" ? 65 : undefined}
              />
            </div>

            <div className="rounded-lg border bg-card p-5">
              <h3 className="type-title mb-2">Eggs — a count ingredient</h3>
              <DriftComparison
                baseUnit="unit"
                standardSetAt={NOW - 20 * DAY}
                drift={{
                  medianCentsPerThousand: 30_900,
                  standardCentsPerThousand: 30_000,
                  percent: 3,
                  severity: "none",
                  drifted: false,
                  stale: false,
                  staleDays: 20,
                  purchaseCount: 3,
                  hasEnoughData: true,
                }}
              />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="type-display-sm">Charts</h2>
          <div className="grid gap-5 lg:grid-cols-2">
            <PriceHistoryChart
              name="Butter"
              baseUnit="g"
              standardCentsPerThousand={420}
              history={
                state === "normal"
                  ? HISTORY
                  : state === "thin"
                    ? HISTORY.slice(0, 1)
                    : []
              }
            />
            <PantryDriftChart
              rows={state === "normal" ? DRIFT_ROWS : []}
              anyDriftComputable={state === "normal"}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="type-display-sm">How current the amounts are</h2>
            {/* Six tabs do not fit a phone. Scrolls in its own container so
                the page body never scrolls sideways. */}
            <Tabs
              value={confidence}
              onValueChange={(v) => setConfidence(v as ConfidenceKey)}
              className="max-w-full overflow-x-auto"
            >
              <TabsList>
                <TabsTrigger value="fresh">Fresh</TabsTrigger>
                <TabsTrigger value="due">Due today</TabsTrigger>
                <TabsTrigger value="neverCounted">Never counted</TabsTrigger>
                <TabsTrigger value="staleReceipts">Stale receipts</TabsTrigger>
                <TabsTrigger value="staleCount">One missed</TabsTrigger>
                <TabsTrigger value="dormant">Dormant</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <p className="type-caption text-muted-foreground">
            Fresh renders nothing at all — that is the design, not a gap. A
            reassurance banner on every load is chrome she learns to skip, and
            she would skip it the day it turned amber.
          </p>
          <ConfidenceNote
            confidence={CONFIDENCE[confidence]}
            orgSlug="kitchen-a"
          />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="type-display-sm">The count</h2>
          <p className="type-caption text-pretty text-muted-foreground">
            The expected amount sits BESIDE an empty field, never in it. A
            pre-filled input cannot tell &ldquo;she looked and it
            matched&rdquo; from &ldquo;she never walked over there&rdquo; — and
            a count is the anchor every pantry number is measured from. ✓ fills
            the field, so she is still confirming rather than counting from
            zero.
          </p>
          <StocktakeForm rows={STOCKTAKE_ROWS} onSave={pause} />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="type-display-sm">The ledger behind the number</h2>
          <Ledger
            rows={LEDGER_ROWS}
            baseUnit="g"
            levelMilli={1_900_000}
            countedAt={NOW - 3 * DAY}
          />
          <div className="flex flex-wrap gap-2">
            <MovementDialog
              trigger={<Button variant="outline" size="sm">Threw some away</Button>}
              title="Throw away some flour?"
              description="It comes off the amount on hand and stays on the books as waste."
              quantityLabel="How much"
              notePlaceholder="Weevils in the bag"
              baseUnit="g"
              signed={false}
              onSubmit={pause}
            />
            <MovementDialog
              trigger={<Button variant="ghost" size="sm">Correct the amount</Button>}
              title="Correct the flour?"
              description="For a bag you found or a delivery with no receipt. This moves the amount without counting the whole lot, so it does not refresh how old the figure is."
              quantityLabel="How far out"
              notePlaceholder="Bag found behind the sugar"
              baseUnit="g"
              signed
              onSubmit={pause}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="type-display-sm">
            &ldquo;Log a buttercream batch too?&rdquo;
          </h2>
          <p className="type-caption text-pretty text-muted-foreground">
            Ticked by default: she is standing in the kitchen having just made
            it, and the common case must cost her nothing. Unticking logs the
            parent alone — Sous flags, it never instructs.
          </p>
          <SubRecipePrompt
            shortfalls={SUB_SHORTFALLS}
            chosen={SUB_SHORTFALLS.filter(
              (s) => !declined.includes(s.subMenuItemId),
            ).map((s) => s.subMenuItemId)}
            onToggle={(id, next) =>
              setDeclined((prev) =>
                next ? prev.filter((d) => d !== id) : [...prev, id],
              )
            }
          />
        </section>
      </main>
    </div>
  );
}
