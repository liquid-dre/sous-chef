"use client";

import * as React from "react";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  costItem,
  rescaleUnitWeight,
  usedBy,
  type CostingItem,
  type CostingWorld,
} from "@/convex/lib/costing";
import { optimise, type FeedbackWarning } from "@/convex/lib/optimiser";
import {
  warningFor,
  type OverrideReport,
  type PortionEvidence,
} from "@/convex/lib/portionEvidence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CostingPanel } from "./costing-panel";
import { OptimiserPanel } from "./optimiser-panel";
import { AxisPicker } from "@/components/feedback/axis-picker";
import type { SensoryAxis } from "@/convex/lib/feedback";
import { RemoveItemDialog } from "./remove-item-dialog";

/**
 * The menu builder. Recipe building is the desktop-comfortable end of the
 * app, so the form and the costing panel sit side by side and she watches
 * the numbers move as she types.
 *
 * Costing runs on the SAME pure engine the server uses
 * (convex/lib/costing.ts), against unsaved form state — so what she watches
 * and what gets stored can never disagree.
 */

const DRAFT_ID = "__draft__";
const DEBOUNCE_MS = 250;

export interface BuilderComponentOption {
  id: string;
  name: string;
  kind: "ingredient" | "menuItem";
  /** Ingredients only. */
  baseUnit?: "g" | "ml" | "unit";
  /** Menu items only — greyed when adding would close a loop. */
  wouldLoop?: boolean;
}

export interface BuilderDraft {
  name: string;
  notSoldDirectly: boolean;
  baseBatchYield: number;
  unitWeightMilligrams: number;
  batchProductionMinutes: number;
  perUnitExtras: { label: string; costCents: number }[];
  priceCents: number | null;
  targetGrossMarginPercent: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  minYield: number | null;
  maxYield: number | null;
  unitWeightFloorMilligrams: number | null;
  constraintNote: string | null;
  leadTimeHours: number | null;
  shelfLifeDays: number | null;
  /** The dimensions customers are asked to rate. Empty until she picks. */
  sensoryAxes: SensoryAxis[];
  lines: {
    key: string;
    componentType: "ingredient" | "menuItem";
    componentId: string;
    qtyMilli: number;
  }[];
}

/**
 * A new item invents nothing. Yield starts at 12 because the arithmetic needs
 * a divisor and she can see and change it; weight and time start at zero
 * because any other number would be one she never gave us, quietly inflating
 * her overhead and handing her a confident cost for an empty recipe.
 */
export const emptyDraft = (): BuilderDraft => ({
  name: "",
  notSoldDirectly: false,
  baseBatchYield: 12,
  unitWeightMilligrams: 0,
  batchProductionMinutes: 0,
  perUnitExtras: [],
  priceCents: null,
  targetGrossMarginPercent: null,
  minPriceCents: null,
  maxPriceCents: null,
  minYield: null,
  maxYield: null,
  unitWeightFloorMilligrams: null,
  constraintNote: null,
  leadTimeHours: null,
  shelfLifeDays: null,
  sensoryAxes: [],
  lines: [],
});

let seq = 0;
const lineKey = () => `line-${seq++}`;

function dollars(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}
function toCents(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function toNumber(raw: string): number | null {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** Everything the draft contributes to the costing world. */
function draftAsCostingItem(draft: BuilderDraft): CostingItem {
  return {
    id: DRAFT_ID,
    name: draft.name || "This item",
    notSoldDirectly: draft.notSoldDirectly,
    baseBatchYield: draft.baseBatchYield,
    unitWeightMilligrams: draft.unitWeightMilligrams,
    batchProductionMinutes: draft.batchProductionMinutes,
    perUnitExtras: draft.perUnitExtras,
    priceCents: draft.notSoldDirectly ? null : draft.priceCents,
    targetGrossMarginPercent: draft.notSoldDirectly
      ? null
      : draft.targetGrossMarginPercent,
    lines: draft.lines.map((l) => ({
      componentType: l.componentType,
      componentId: l.componentId,
      qtyMilli: l.qtyMilli,
    })),
  };
}

export function MenuBuilder({
  initial,
  world,
  options,
  driftNotice,
  onSave,
  onDelete,
  saving,
  feedbackWarnings,
  portionEvidence,
  overriddenYields,
  overrideReport,
  onOverride,
  onUndoOverride,
  overrideBusy,
  readout,
  setAsideAt = null,
  setAsideMarginPercent = null,
  onSetAside,
  onRestore,
}: {
  initial: BuilderDraft;
  /** The saved graph this draft costs against. */
  world: CostingWorld;
  options: BuilderComponentOption[];
  driftNotice?: React.ReactNode;
  onSave: (draft: BuilderDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  saving?: boolean;
  /** From convex/feedback.ts. Constrains the optimiser as a WARNING, never a
   * veto (CONTEXT.md) — it renders beside the arithmetic, never into it. */
  feedbackWarnings?: FeedbackWarning[];
  /** Ratings traced to the size each tray was cut at. */
  portionEvidence?: PortionEvidence | null;
  /** Sizes she has already decided about. The warning is silent at these and
   * at no others. */
  overriddenYields?: number[];
  overrideReport?: OverrideReport | null;
  onOverride?: () => void;
  onUndoOverride?: () => void;
  overrideBusy?: boolean;
  /** The sensory readout. Rendered below the optimiser because it answers
   * the same question from the other side: the optimiser says what the
   * numbers would need, this says what the people got. */
  readout?: React.ReactNode;
  /** Persisted on the item, not in the draft: setting the optimiser aside is
   * a decision about the item, not an unsaved edit to it. */
  setAsideAt?: number | null;
  setAsideMarginPercent?: number | null;
  onSetAside?: (marginPercent: number) => void;
  onRestore?: () => void;
}) {
  const [draft, setDraft] = React.useState<BuilderDraft>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof BuilderDraft>(key: K, value: BuilderDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Live recalculation, debounced — every field except yield, which commits
  // on leaving the field so the numbers never thrash through an
  // intermediate value.
  const [costingDraft, setCostingDraft] = React.useState(draft);
  const serialized = JSON.stringify(draft);
  React.useEffect(() => {
    const timer = setTimeout(() => setCostingDraft(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serialized IS draft
  }, [serialized]);

  const costingWorld: CostingWorld = React.useMemo(
    () => ({
      ...world,
      items: { ...world.items, [DRAFT_ID]: draftAsCostingItem(costingDraft) },
    }),
    [world, costingDraft],
  );
  const costing = React.useMemo(
    () => costItem(DRAFT_ID, costingWorld),
    [costingWorld],
  );

  /** The solution surface, off the same debounced draft as the costing, so
   * the two panels can never describe different items. */
  const optimisation = React.useMemo(
    () =>
      optimise({
        costing,
        constraints: {
          minPriceCents: costingDraft.minPriceCents,
          maxPriceCents: costingDraft.maxPriceCents,
          minYield: costingDraft.minYield,
          maxYield: costingDraft.maxYield,
          unitWeightFloorMilligrams: costingDraft.unitWeightFloorMilligrams,
          constraintNote: costingDraft.constraintNote,
        },
        feedbackWarnings,
      }),
    [costing, costingDraft, feedbackWarnings],
  );

  /**
   * The one warning about the size she is on.
   *
   * Computed HERE rather than in the container for two reasons the sentence
   * depends on. It follows `costingDraft`, so it names the yield she is
   * typing rather than the one that was saved — the whole argument is about a
   * size, and a warning naming last week's size would be worse than none. And
   * `verdict.targetYield` only exists once the solver has run, which is what
   * lets it finish the thought: "…and 20 cuts it smaller."
   */
  const portionWarning = React.useMemo(
    () =>
      portionEvidence
        ? warningFor(
            portionEvidence,
            costingDraft.baseBatchYield,
            optimisation.verdict.targetYield,
            overriddenYields ?? [],
          )
        : null,
    [portionEvidence, costingDraft.baseBatchYield, optimisation, overriddenYields],
  );

  /** Yield commits: rescale unit weight in the same breath. Same tray, cut
   * differently — total mass is constant, so each piece shrinks. */
  const commitYield = (next: number | ((current: number) => number)) => {
    setDraft((d) => {
      const value =
        typeof next === "function" ? next(d.baseBatchYield) : next;
      if (value < 1 || value === d.baseBatchYield) return d;
      return {
        ...d,
        baseBatchYield: value,
        unitWeightMilligrams: rescaleUnitWeight(
          d.unitWeightMilligrams,
          d.baseBatchYield,
          value,
        ),
      };
    });
  };

  const hasLimit =
    draft.minPriceCents != null ||
    draft.maxPriceCents != null ||
    draft.minYield != null ||
    draft.maxYield != null ||
    draft.unitWeightFloorMilligrams != null;
  const noteMissing = hasLimit && !draft.constraintNote?.trim();
  // The same rule menuItems.save enforces: zero, or two to four, never one.
  // Checked here too so the button explains itself rather than the server
  // throwing after she has already committed.
  const axesInvalid = draft.sensoryAxes.length === 1;

  // Limits flag her; they never bar the door (they bind the optimiser).
  const priceWarning =
    draft.priceCents != null &&
    ((draft.maxPriceCents != null && draft.priceCents > draft.maxPriceCents) ||
      (draft.minPriceCents != null && draft.priceCents < draft.minPriceCents));
  const yieldWarning =
    (draft.maxYield != null && draft.baseBatchYield > draft.maxYield) ||
    (draft.minYield != null && draft.baseBatchYield < draft.minYield);

  const usedByItems = draft.notSoldDirectly
    ? usedBy(initial.name ? DRAFT_ID : DRAFT_ID, world.items)
    : null;

  const addLine = (option: BuilderComponentOption) => {
    setDraft((d) => ({
      ...d,
      lines: [
        ...d.lines,
        {
          key: lineKey(),
          componentType: option.kind,
          componentId: option.id,
          qtyMilli: 0,
        },
      ],
    }));
  };

  // minmax(0,…) on the single-column case too: an auto track sizes itself to
  // the column's min-content and pushes past the viewport on a narrow phone.
  // The lg: template already guarded against this; the base did not.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="mi-name" className="type-label">
              Name
            </Label>
            <Input
              id="mi-name"
              value={draft.name}
              placeholder="Chocolate fudge cake"
              className="mt-1.5"
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2.5 pb-2">
            <Switch
              id="mi-sub"
              checked={draft.notSoldDirectly}
              onCheckedChange={(v) => set("notSoldDirectly", v)}
            />
            <Label htmlFor="mi-sub">
              A sub-recipe
              <span className="type-caption ml-2 text-muted-foreground">
                used inside other items, never sold on its own
              </span>
            </Label>
          </div>
        </div>

        {/* ---- Recipe -------------------------------------------------- */}
        <section
          aria-label="Recipe"
          className="flex flex-col gap-3 rounded-lg border bg-card p-5"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="type-title">Recipe</h2>
            <span className="type-caption text-muted-foreground">
              for one batch of {draft.baseBatchYield}
            </span>
          </div>

          {draft.lines.length === 0 ? (
            <p className="type-body text-muted-foreground">
              Nothing in it yet. Add an ingredient or another menu item below.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {draft.lines.map((line) => {
                const option = options.find((o) => o.id === line.componentId);
                const isSub = line.componentType === "menuItem";
                const unitLabel = isSub
                  ? "units"
                  : (option?.baseUnit ?? "g") === "unit"
                    ? "each"
                    : (option?.baseUnit ?? "g");
                return (
                  <li
                    key={line.key}
                    className={cn(
                      // Tighter gutters on a phone: the name is what she reads,
                      // so the fixed columns give ground before it truncates.
                      "flex items-center gap-2 py-2 md:gap-3",
                      // Sub-recipe lines are visually distinct from ingredients.
                      isSub && "border-l-2 border-primary pl-3",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "type-body block truncate",
                          isSub && "text-primary",
                        )}
                      >
                        {option?.name ?? "(removed)"}
                      </span>
                      {isSub && (
                        <span className="type-caption text-muted-foreground">
                          sub-recipe
                        </span>
                      )}
                    </span>
                    <Input
                      value={
                        line.qtyMilli === 0 ? "" : String(line.qtyMilli / 1000)
                      }
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`Quantity of ${option?.name ?? "line"}`}
                      className="numeric-body w-20 md:w-24"
                      onChange={(e) => {
                        const n = toNumber(e.target.value) ?? 0;
                        setDraft((d) => ({
                          ...d,
                          lines: d.lines.map((l) =>
                            l.key === line.key
                              ? { ...l, qtyMilli: Math.round(n * 1000) }
                              : l,
                          ),
                        }));
                      }}
                    />
                    <span className="type-caption w-9 shrink-0 text-muted-foreground md:w-10">
                      {unitLabel}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${option?.name ?? "line"}`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          lines: d.lines.filter((l) => l.key !== line.key),
                        }))
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <ComponentPicker options={options} onPick={addLine} />
        </section>

        {/* ---- Per-unit extras ----------------------------------------- */}
        <section
          aria-label="Per-unit extras"
          className="flex flex-col gap-3 rounded-lg border bg-card p-5"
        >
          <div>
            <h2 className="type-title">Per-unit extras</h2>
            <p className="type-caption text-muted-foreground">
              Layer 2 — what goes around each one: box, ribbon, sticker.
            </p>
          </div>
          {draft.perUnitExtras.map((extra, i) => (
            <div key={i} className="flex items-center gap-3">
              <Input
                value={extra.label}
                placeholder="Box"
                aria-label="Extra name"
                className="flex-1"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    perUnitExtras: d.perUnitExtras.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  }))
                }
              />
              <div className="relative w-28">
                <span className="numeric-sm pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  value={dollars(extra.costCents)}
                  inputMode="decimal"
                  aria-label="Extra cost"
                  className="numeric-body pl-7 md:pl-7"
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      perUnitExtras: d.perUnitExtras.map((x, j) =>
                        j === i
                          ? { ...x, costCents: toCents(e.target.value) ?? 0 }
                          : x,
                      ),
                    }))
                  }
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${extra.label || "extra"}`}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    perUnitExtras: d.perUnitExtras.filter((_, j) => j !== i),
                  }))
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  perUnitExtras: [...d.perUnitExtras, { label: "", costCents: 0 }],
                }))
              }
            >
              <Plus aria-hidden data-icon="inline-start" />
              Add an extra
            </Button>
          </div>
        </section>

        {/* ---- Timing and shelf ---------------------------------------- */}
        <section
          aria-label="Time"
          className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-3"
        >
          <Field
            id="mi-minutes"
            label="Time per batch"
            hint="Your labour, gas and power — layer 3."
          >
            <div className="flex items-center gap-2">
              <Input
                id="mi-minutes"
                value={String(draft.batchProductionMinutes)}
                inputMode="numeric"
                className="numeric-body"
                onChange={(e) =>
                  set("batchProductionMinutes", toNumber(e.target.value) ?? 0)
                }
              />
              <span className="type-caption text-muted-foreground">min</span>
            </div>
          </Field>
          <Field id="mi-lead" label="Lead time" hint="Notice you need.">
            <div className="flex items-center gap-2">
              <Input
                id="mi-lead"
                value={draft.leadTimeHours == null ? "" : String(draft.leadTimeHours)}
                inputMode="numeric"
                placeholder="48"
                className="numeric-body"
                onChange={(e) => set("leadTimeHours", toNumber(e.target.value))}
              />
              <span className="type-caption text-muted-foreground">hours</span>
            </div>
          </Field>
          {!draft.notSoldDirectly && (
            <Field id="mi-shelf" label="Shelf life" hint="Required for anything you sell.">
              <div className="flex items-center gap-2">
                <Input
                  id="mi-shelf"
                  value={draft.shelfLifeDays == null ? "" : String(draft.shelfLifeDays)}
                  inputMode="numeric"
                  placeholder="3"
                  className="numeric-body"
                  onChange={(e) => set("shelfLifeDays", toNumber(e.target.value))}
                />
                <span className="type-caption text-muted-foreground">days</span>
              </div>
            </Field>
          )}
        </section>

        {/* ---- Price and limits ---------------------------------------- */}
        {!draft.notSoldDirectly && (
          <section
            aria-label="Price"
            className="flex flex-col gap-4 rounded-lg border bg-card p-5"
          >
            <h2 className="type-title">Price</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="mi-price" label="You charge">
                <div className="relative">
                  <span className="numeric-sm pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="mi-price"
                    value={dollars(draft.priceCents)}
                    inputMode="decimal"
                    placeholder="3.00"
                    className="numeric-body pl-7 md:pl-7"
                    onChange={(e) => set("priceCents", toCents(e.target.value))}
                  />
                </div>
              </Field>
              <Field id="mi-target" label="Target gross margin">
                <div className="relative">
                  <Input
                    id="mi-target"
                    value={
                      draft.targetGrossMarginPercent == null
                        ? ""
                        : String(draft.targetGrossMarginPercent)
                    }
                    inputMode="numeric"
                    placeholder="65"
                    className="numeric-body pr-8 md:pr-8"
                    onChange={(e) =>
                      set("targetGrossMarginPercent", toNumber(e.target.value))
                    }
                  />
                  <span className="numeric-sm pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
                    %
                  </span>
                </div>
              </Field>
            </div>

            <details className="rounded-md border">
              <summary className="type-label min-h-11 cursor-pointer list-none px-3 py-3 md:min-h-9">
                Limits for the optimiser
                <span className="type-caption ml-2 text-muted-foreground">
                  {/* It shows what is outside them, struck through with your
                      reason — seeing the fence beats being told no. */}
                  it will never recommend outside these
                </span>
              </summary>
              <div className="flex flex-col gap-4 border-t p-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <LimitField
                    label="Lowest price"
                    prefix="$"
                    value={dollars(draft.minPriceCents)}
                    onChange={(v) => set("minPriceCents", toCents(v))}
                  />
                  <LimitField
                    label="Highest price"
                    prefix="$"
                    value={dollars(draft.maxPriceCents)}
                    onChange={(v) => set("maxPriceCents", toCents(v))}
                  />
                  <LimitField
                    label="Fewest units"
                    value={draft.minYield == null ? "" : String(draft.minYield)}
                    onChange={(v) => set("minYield", toNumber(v))}
                  />
                  <LimitField
                    label="Most units"
                    value={draft.maxYield == null ? "" : String(draft.maxYield)}
                    onChange={(v) => set("maxYield", toNumber(v))}
                  />
                </div>
                <LimitField
                  label="Never smaller than"
                  suffix="g"
                  value={
                    draft.unitWeightFloorMilligrams == null
                      ? ""
                      : String(draft.unitWeightFloorMilligrams / 1000)
                  }
                  onChange={(v) => {
                    const n = toNumber(v);
                    set(
                      "unitWeightFloorMilligrams",
                      n == null ? null : Math.round(n * 1000),
                    );
                  }}
                />
                {hasLimit && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="mi-note" className="type-label">
                      Why? <span className="text-loss">Required</span>
                    </Label>
                    <Textarea
                      id="mi-note"
                      rows={2}
                      value={draft.constraintNote ?? ""}
                      placeholder="Church stall won't pay more than $4."
                      aria-invalid={noteMissing || undefined}
                      onChange={(e) => set("constraintNote", e.target.value)}
                    />
                    <p className="type-caption text-muted-foreground">
                      In six months this note is the only thing that will
                      explain the limit.
                    </p>
                  </div>
                )}
              </div>
            </details>

            {(priceWarning || yieldWarning) && draft.constraintNote && (
              <p className="type-label flex items-start gap-2 rounded-md bg-warn-soft p-3 text-warn-foreground">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  {priceWarning ? "That price is" : "That yield is"} outside the
                  limit you set — &ldquo;{draft.constraintNote}&rdquo;. Saving
                  anyway is fine; it is your call.
                </span>
              </p>
            )}
          </section>
        )}

        {/* What customers get asked about. Beside Price because both are
            decisions about how the item meets the person buying it, and
            because a sub-recipe is never tasted on its own. */}
        {!draft.notSoldDirectly && (
          <section
            aria-label="What to ask customers"
            className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:p-5"
          >
            <h2 className="type-title">What to ask customers</h2>
            <AxisPicker
              value={draft.sensoryAxes}
              itemName={draft.name.trim()}
              onChange={(sensoryAxes) => setDraft((d) => ({ ...d, sensoryAxes }))}
            />
          </section>
        )}

        {error && (
          <p className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            size="lg"
            disabled={saving || noteMissing || axesInvalid || draft.name.trim() === ""}
            onClick={async () => {
              setError(null);
              try {
                await onSave(draft);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Couldn't save — try again.",
                );
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          {noteMissing && (
            <p className="type-caption text-muted-foreground">
              A limit needs its reason before this can save.
            </p>
          )}
          {onDelete && (
            <RemoveItemDialog
              name={draft.name}
              lineCount={draft.lines.length}
              onRemove={onDelete}
            />
          )}
        </div>
      </div>

      {/* The costing says what it costs; the optimiser says what would reach
          her target; the readout says what people actually thought of it.
          Same column, because they are the same question asked three ways,
          and on a phone they stack in that order. */}
      <div className="flex flex-col gap-6 lg:sticky lg:top-6">
        <CostingPanel
          costing={costing}
          yieldUnits={draft.baseBatchYield}
          unitWeightMilligrams={draft.unitWeightMilligrams}
          onYieldCommit={commitYield}
          driftNotice={driftNotice}
          usedByItems={usedByItems}
        />
        {/* Sub-recipes have no price and no target, so there is nothing to
            optimise toward — they are costed, never sold. */}
        {!draft.notSoldDirectly && (
          <OptimiserPanel
            optimisation={optimisation}
            // The presence of a drift notice IS the staleness signal: these
            // figures come off the same standard costs the costing does.
            costsMayBeStale={driftNotice != null}
            portionEvidence={portionEvidence}
            portionWarning={portionWarning}
            overrideReport={overrideReport}
            onOverride={onOverride}
            onUndoOverride={onUndoOverride}
            overrideBusy={overrideBusy}
            setAsideAt={setAsideAt}
            setAsideMarginPercent={setAsideMarginPercent}
            onSetAside={onSetAside}
            onRestore={onRestore}
          />
        )}
        {!draft.notSoldDirectly && readout}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="type-label">
        {label}
      </Label>
      {children}
      {hint && <p className="type-caption text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LimitField({
  label,
  value,
  prefix,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  prefix?: string;
  suffix?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="type-caption text-muted-foreground">{label}</Label>
      <div className="relative">
        {prefix && (
          <span className="numeric-sm pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
            {prefix}
          </span>
        )}
        <Input
          value={value}
          inputMode="decimal"
          aria-label={label}
          className={cn("numeric-body", prefix && "pl-7 md:pl-7", suffix && "pr-8 md:pr-8")}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && (
          <span className="numeric-sm pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/** Adding a line is one tap. Components that would close a loop are shown
 * greyed with the reason rather than hidden — she learns the shape of her
 * own menu instead of wondering where something went. */
function ComponentPicker({
  options,
  onPick,
}: {
  options: BuilderComponentOption[];
  onPick: (option: BuilderComponentOption) => void;
}) {
  const [term, setTerm] = React.useState("");
  const matches = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    return options
      .filter((o) => !needle || o.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [options, term]);

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <Input
        value={term}
        placeholder="Add an ingredient or sub-recipe…"
        aria-label="Add a recipe line"
        onChange={(e) => setTerm(e.target.value)}
      />
      <ul className="flex flex-wrap gap-1.5">
        {matches.map((option) => (
          <li key={`${option.kind}-${option.id}`}>
            <button
              type="button"
              disabled={option.wouldLoop}
              title={
                option.wouldLoop
                  ? `${option.name} already contains this — adding it would loop.`
                  : undefined
              }
              onClick={() => {
                onPick(option);
                setTerm("");
              }}
              className={cn(
                "flex min-h-11 items-center gap-1.5 rounded-full border px-3 type-label outline-none transition-transform duration-[var(--duration-fast)] ease-out focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9",
                option.wouldLoop
                  ? "cursor-not-allowed opacity-40"
                  : "hover:bg-muted active:scale-[0.97]",
                option.kind === "menuItem" && !option.wouldLoop && "border-primary text-primary",
              )}
            >
              <Plus aria-hidden className="size-3.5" />
              {option.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
