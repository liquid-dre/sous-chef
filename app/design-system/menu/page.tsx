"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  evidenceFor,
  reportFor,
  type BatchFact,
  type PortionRating,
} from "@/convex/lib/portionEvidence";
import { TriangleAlert } from "lucide-react";
import {
  MenuBuilder,
  emptyDraft,
  type BuilderComponentOption,
  type BuilderDraft,
} from "@/components/menu/menu-builder";
import type { CostingWorld } from "@/convex/lib/costing";

/**
 * Menu builder specimen — the grading surface. Mounts the real builder and
 * the real cost engine with a three-level nest (Brownie → Buttercream →
 * Butter), so live recalculation, layer expansion, yield-commit and the
 * loop-guarded picker are all reviewable without a session.
 */

const INGREDIENTS = {
  butter: { id: "butter", name: "Butter", baseUnit: "g" as const, standardCostCentsPerThousand: 420 },
  flour: { id: "flour", name: "Flour", baseUnit: "g" as const, standardCostCentsPerThousand: 185 },
  sugar: { id: "sugar", name: "Sugar", baseUnit: "g" as const, standardCostCentsPerThousand: 150 },
  cocoa: { id: "cocoa", name: "Cocoa", baseUnit: "g" as const, standardCostCentsPerThousand: 910 },
  /** $10.80/kg, so 500 g is exactly the worked case's $5.40 a tray. */
  chocolate: { id: "chocolate", name: "Chocolate", baseUnit: "g" as const, standardCostCentsPerThousand: 1080 },
  eggs: { id: "eggs", name: "Eggs", baseUnit: "unit" as const, standardCostCentsPerThousand: 30_000 },
};

/** The saved world the draft costs against. Buttercream is a real saved
 * sub-recipe; the item being edited is the draft itself. */
const WORLD: CostingWorld = {
  ingredients: INGREDIENTS,
  overheadRateCentsPerHour: 800,
  items: {
    buttercream: {
      id: "buttercream",
      name: "Buttercream",
      notSoldDirectly: true,
      baseBatchYield: 10,
      unitWeightMilligrams: 100_000,
      batchProductionMinutes: 20,
      perUnitExtras: [],
      priceCents: null,
      targetGrossMarginPercent: null,
      lines: [
        { componentType: "ingredient", componentId: "butter", qtyMilli: 1_000_000 },
      ],
    },
    sourdough: {
      id: "sourdough",
      name: "Sourdough loaf",
      notSoldDirectly: false,
      baseBatchYield: 4,
      unitWeightMilligrams: 800_000,
      batchProductionMinutes: 180,
      perUnitExtras: [],
      priceCents: 850,
      targetGrossMarginPercent: 60,
      lines: [
        { componentType: "ingredient", componentId: "flour", qtyMilli: 2_000_000 },
      ],
    },
  },
};

const BROWNIE: BuilderDraft = {
  ...emptyDraft(),
  name: "Brownies",
  baseBatchYield: 12,
  unitWeightMilligrams: 85_000,
  batchProductionMinutes: 60,
  shelfLifeDays: 3,
  leadTimeHours: 48,
  priceCents: 300,
  targetGrossMarginPercent: 65,
  maxPriceCents: 400,
  constraintNote: "Church stall won't pay more than $4.",
  perUnitExtras: [{ label: "Box", costCents: 20 }],
  lines: [
    { key: "l1", componentType: "menuItem", componentId: "buttercream", qtyMilli: 2_000 },
    { key: "l2", componentType: "ingredient", componentId: "flour", qtyMilli: 500_000 },
    { key: "l3", componentType: "ingredient", componentId: "cocoa", qtyMilli: 150_000 },
    { key: "l4", componentType: "ingredient", componentId: "eggs", qtyMilli: 3_000 },
  ],
};

const SUB: BuilderDraft = {
  ...emptyDraft(),
  name: "Buttercream",
  notSoldDirectly: true,
  baseBatchYield: 10,
  unitWeightMilligrams: 100_000,
  batchProductionMinutes: 20,
  lines: [
    { key: "s1", componentType: "ingredient", componentId: "butter", qtyMilli: 1_000_000 },
  ],
};

const OPTIONS: BuilderComponentOption[] = [
  ...Object.values(INGREDIENTS).map((i) => ({
    id: i.id,
    name: i.name,
    kind: "ingredient" as const,
    baseUnit: i.baseUnit,
  })),
  { id: "buttercream", name: "Buttercream", kind: "menuItem" as const },
  { id: "sourdough", name: "Sourdough loaf", kind: "menuItem" as const },
].sort((a, b) => a.name.localeCompare(b.name));

/** In the sub-recipe view, the brownie would loop — the picker greys it. */
const OPTIONS_FOR_SUB: BuilderComponentOption[] = OPTIONS.map((o) =>
  o.id === "buttercream" ? { ...o, wouldLoop: true } : o,
);

/**
 * The worked case, exactly as scoped: $5.40 of chocolate a tray, a 42c box on
 * every brownie, $2.00 each, cut into 12, 65% wanted. Chocolate at $10.80/kg
 * × 500 g is 540c, so layer 1 is 540 and layer 2 is 42 — the two numbers the
 * whole solution surface turns on.
 */
const WORKED: BuilderDraft = {
  ...emptyDraft(),
  name: "Brownies",
  baseBatchYield: 12,
  unitWeightMilligrams: 85_000,
  batchProductionMinutes: 30,
  shelfLifeDays: 3,
  priceCents: 200,
  targetGrossMarginPercent: 65,
  perUnitExtras: [{ label: "Box", costCents: 42 }],
  lines: [
    { key: "w1", componentType: "ingredient", componentId: "chocolate", qtyMilli: 500_000 },
  ],
};

const FLOOR_NOTE = "Anything under 60 g and the church stall calls it mean.";


/**
 * The portion evidence, through the REAL engine.
 *
 * `convex/lib/portionEvidence.ts` is pure, so it imports straight into the
 * browser and every sentence on this page is arithmetic rather than a
 * plausible-looking constant. Four shapes, because those are the ones that
 * exist: no feedback at all (the panel must be byte-identical to 1.3), one
 * size served, two sizes with a real split, and a case where a third of the
 * ratings cannot be placed on any batch.
 */
const CURRENT_YIELD = 12;

function ratingsAndBatches(
  spec: { yieldUnits: number; values: number[] }[],
  orphans = 0,
): { ratings: PortionRating[]; batches: BatchFact[] } {
  const ratings: PortionRating[] = [];
  const batches: BatchFact[] = [];
  let order = 0;
  for (const group of spec) {
    const orderIds: string[] = [];
    for (const value of group.values) {
      const orderId = `o${order++}`;
      orderIds.push(orderId);
      ratings.push({ orderId, value, receivedAt: 1_000 + order });
    }
    batches.push({
      productionLogId: `b${group.yieldUnits}`,
      orderIds,
      yieldUnits: group.yieldUnits,
      batchCount: 1,
      producedAt: 0,
    });
  }
  // Ratings on orders no batch claims — the ordinary case of a bake logged
  // without the order ticked.
  for (let i = 0; i < orphans; i += 1) {
    ratings.push({ orderId: `x${i}`, value: -2, receivedAt: 5_000 + i });
  }
  return { ratings, batches };
}

const PORTION_SPECS: Record<
  string,
  { label: string; spec: { yieldUnits: number; values: number[] }[]; orphans: number }
> = {
  none: { label: "No feedback", spec: [], orphans: 0 },
  oneSize: {
    label: "One size",
    spec: [{ yieldUnits: 12, values: [-2, -1, 0] }],
    orphans: 0,
  },
  twoSizes: {
    label: "Two sizes",
    spec: [
      { yieldUnits: 12, values: [-1, 0, 0, 1, 0, 0, 1, 0, 0] },
      { yieldUnits: 15, values: [-2, -2, -1, -1, 0] },
    ],
    orphans: 0,
  },
  patchy: {
    label: "Patchy coverage",
    spec: [
      { yieldUnits: 12, values: [-1, 0, 0] },
      { yieldUnits: 15, values: [-2, -1] },
    ],
    orphans: 3,
  },
};

type PortionKey = keyof typeof PORTION_SPECS;

const PORTIONS = Object.fromEntries(
  Object.entries(PORTION_SPECS).map(([key, { label, spec, orphans }]) => {
    const { ratings, batches } = ratingsAndBatches(spec, orphans);
    return [key, { label, ratings, batches, evidence: evidenceFor(ratings, batches) }];
  }),
) as Record<
  PortionKey,
  {
    label: string;
    ratings: PortionRating[];
    batches: BatchFact[];
    evidence: ReturnType<typeof evidenceFor>;
  }
>;

/** The five things the panel has to be able to say. */
const CASES: Record<string, { label: string; draft: BuilderDraft }> = {
  reachable: { label: "Reaches at 20", draft: WORKED },
  blocked: {
    label: "Floor blocks it",
    draft: { ...WORKED, unitWeightFloorMilligrams: 60_000, constraintNote: FLOOR_NOTE },
  },
  ceiling: {
    label: "Ceiling",
    draft: { ...WORKED, targetGrossMarginPercent: 85 },
  },
  noTarget: {
    label: "No target",
    draft: { ...WORKED, targetGrossMarginPercent: null },
  },
  noCost: {
    label: "Nothing costed",
    draft: { ...WORKED, lines: [], perUnitExtras: [], batchProductionMinutes: 0 },
  },
};

type CaseKey = keyof typeof CASES;

const pause = () => new Promise<void>((r) => setTimeout(r, 400));

type View = "item" | "worked" | "sub" | "empty";

export default function MenuSpecimenPage() {
  /**
   * Every combination on this page is a link, so a reviewer can be sent
   * straight to the case being discussed rather than a list of tabs to click.
   *
   * `useSyncExternalStore` rather than a useState initialiser or an effect.
   * Reading `window.location` while initialising state makes the first client
   * render disagree with the server's — React reported exactly that here, a
   * recoverable hydration error — and setting state in an effect is banned by
   * this project's lint for the same class of reason. The server snapshot is
   * the empty string, so the server and the hydrating client agree, and React
   * re-renders once with the real query. Subscribing is a no-op because
   * nothing navigates this page without a full load.
   */
  const query = React.useSyncExternalStore(
    () => () => {},
    () => window.location.search,
    () => "",
  );
  const params = React.useMemo(() => new URLSearchParams(query), [query]);

  const [viewOverride, setView] = React.useState<View | null>(null);
  const [drift, setDrift] = React.useState(true);
  const [caseOverride, setCaseKey] = React.useState<CaseKey | null>(null);
  const [setAside, setSetAside] = React.useState<{ at: number; margin: number } | null>(null);
  const [portionOverride, setPortion] = React.useState<PortionKey | null>(null);
  const [overriddenOverride, setOverridden] = React.useState<boolean | null>(null);

  // Her clicks win once she has made one; the URL seeds the first render.
  const view = viewOverride ?? ((params.get("view") as View) || "item");
  const caseKey = caseOverride ?? ((params.get("case") as CaseKey) || "reachable");
  const portion =
    portionOverride ?? ((params.get("portion") as PortionKey) || "none");
  const overridden = overriddenOverride ?? params.get("overridden") === "1";



  const draft =
    view === "item"
      ? BROWNIE
      : view === "worked"
        ? CASES[caseKey].draft
        : view === "sub"
          ? SUB
          : emptyDraft();

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Menu builder specimen — sample data, saves are pretend
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => setDrift((d) => !d)}
            aria-pressed={drift}
          >
            Drift notice {drift ? "on" : "off"}
          </Button>
          {/* TabsList is inline-flex w-fit and will not wrap, so on a phone
              it scrolls rather than pushing the page sideways. */}
          <div className="min-w-0 max-w-full overflow-x-auto">
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="item">Sold item</TabsTrigger>
                <TabsTrigger value="worked">Worked case</TabsTrigger>
                <TabsTrigger value="sub">Sub-recipe</TabsTrigger>
                <TabsTrigger value="empty">New, empty</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ModeToggle />
        </div>
        {view === "worked" && (
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="type-caption text-muted-foreground">
              Portion evidence
            </span>
            <div className="min-w-0 max-w-full overflow-x-auto">
              <Tabs
                value={portion}
                onValueChange={(v) => {
                  setPortion(v as PortionKey);
                  setOverridden(false);
                }}
              >
                <TabsList>
                  {(Object.keys(PORTIONS) as PortionKey[]).map((key) => (
                    <TabsTrigger key={key} value={key}>
                      {PORTIONS[key].label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
        )}
        {view === "worked" && (
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="type-caption text-muted-foreground">
              Optimiser case
            </span>
            <div className="min-w-0 max-w-full overflow-x-auto">
              <Tabs value={caseKey} onValueChange={(v) => setCaseKey(v as CaseKey)}>
                <TabsList>
                  {(Object.keys(CASES) as CaseKey[]).map((key) => (
                    <TabsTrigger key={key} value={key}>
                      {CASES[key].label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
        )}
      </div>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">
        <MenuBuilder
          key={`${view}-${caseKey}`}
          initial={draft}
          world={WORLD}
          options={view === "sub" ? OPTIONS_FOR_SUB : OPTIONS}
          portionEvidence={view === "worked" ? PORTIONS[portion].evidence : null}
          overriddenYields={overridden ? [CURRENT_YIELD] : []}
          overrideReport={
            view === "worked" && overridden
              ? reportFor(
                  PORTIONS[portion].ratings,
                  PORTIONS[portion].batches,
                  {
                    yieldUnits: CURRENT_YIELD,
                    decidedAt: 0,
                    saidTooSmallAtDecision: 1,
                    sampleAtDecision: 9,
                    grossMarginPercentAtDecision: 54,
                  },
                  61,
                )
              : null
          }
          onOverride={view === "worked" ? () => setOverridden(true) : undefined}
          onUndoOverride={view === "worked" ? () => setOverridden(false) : undefined}
          setAsideAt={setAside?.at ?? null}
          setAsideMarginPercent={setAside?.margin ?? null}
          onSetAside={(margin) => setSetAside({ at: Date.now(), margin })}
          onRestore={() => setSetAside(null)}
          onSave={pause}
          onDelete={view === "empty" ? undefined : pause}
          driftNotice={
            drift ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md bg-warn-soft p-3">
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn-foreground" />
                <p className="type-label min-w-40 flex-1 text-warn-foreground">
                  Butter has moved away from the cost you set. This costing
                  still uses your standard costs.
                </p>
              </div>
            ) : undefined
          }
        />
      </main>
    </div>
  );
}
