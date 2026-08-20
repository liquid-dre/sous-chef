/**
 * The cost engine. Pure — no Convex imports — because it has to run in three
 * places: the builder (live, against unsaved form state), the server (on
 * save), and unit tests.
 *
 * The roll-up rule is CONTEXT.md's, not the obvious one. A sub-recipe is NOT
 * dissolved into raw ingredients; it enters its parent as a component priced
 * at its own per-unit VARIABLE cost (layer 1 + layer 2) × units consumed.
 * That means a sub-recipe's packaging becomes part of its parent's layer 1 —
 * odd-looking, correct, and the only reading of "the sub's per-unit variable
 * cost × units consumed" that doesn't silently discard layer 2.
 *
 * Time rolls up separately: a sub contributes its batch minutes in
 * proportion to how much of its batch the parent consumes, and that lands in
 * the parent's layer 3, keeping the three layers meaningful all the way up.
 */

export type BaseUnit = "g" | "ml" | "unit";

export interface CostingIngredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  /** Cents per 1000 base units — per kg, per litre, or per 1000 count. */
  standardCostCentsPerThousand: number;
}

export interface CostingLine {
  componentType: "ingredient" | "menuItem";
  componentId: string;
  /** Milli-base-units for ingredients; milli-units for sub-recipes. */
  qtyMilli: number;
}

export interface CostingItem {
  id: string;
  name: string;
  notSoldDirectly: boolean;
  baseBatchYield: number;
  unitWeightMilligrams: number;
  batchProductionMinutes: number;
  perUnitExtras: { label: string; costCents: number }[];
  priceCents?: number | null;
  targetGrossMarginPercent?: number | null;
  lines: CostingLine[];
}

export interface CostingWorld {
  items: Record<string, CostingItem>;
  ingredients: Record<string, CostingIngredient>;
  overheadRateCentsPerHour: number;
}

/** One row of the arithmetic behind a layer. She taps a number, she gets
 * these — a derived number with no breakdown is a defect. */
export interface CostLine {
  kind: "ingredient" | "subRecipe" | "extra" | "time";
  id?: string;
  name: string;
  /** Human-readable working: "500 g × $1.85/kg". */
  detail: string;
  centsPerBatch: number;
  centsPerUnit: number;
  /** Sub-recipes carry their own composition, expanded in place. */
  children?: CostLine[];
}

export interface Layer {
  centsPerBatch: number;
  centsPerUnit: number;
  lines: CostLine[];
}

export interface Costing {
  itemId: string;
  yieldUnits: number;
  unitWeightMilligrams: number;
  ingredients: Layer;
  extras: Layer;
  overhead: Layer & { minutesPerBatch: number };
  variableCentsPerUnit: number;
  variableCentsPerBatch: number;
  totalCentsPerUnit: number;
  totalCentsPerBatch: number;
  priceCents: number | null;
  grossMarginPercent: number | null;
  netMarginPercent: number | null;
  targetGrossMarginPercent: number | null;
  /** True when a price exists and gross sits below her own target. */
  belowTarget: boolean;
}

const MAX_DEPTH = 16;

// --- Cycles ---------------------------------------------------------------

/**
 * The cycle through `startId`, as names, or null. Returned as a path so the
 * message can say exactly what loops: Brownie → Buttercream → Brownie.
 */
export function findCycle(
  startId: string,
  items: Record<string, CostingItem>,
): string[] | null {
  const path: string[] = [];
  // Names are what she reads; ids are what we slice by. Keeping both is the
  // difference between "Brownie → Buttercream → Brownie" and a truncated
  // fragment that names the loop wrong.
  const idPath: string[] = [];
  const onPath = new Set<string>();

  const walk = (id: string, depth: number): string[] | null => {
    const item = items[id];
    if (!item) return null;
    if (onPath.has(id)) {
      const from = idPath.indexOf(id);
      return [...path.slice(from), item.name];
    }
    if (depth > MAX_DEPTH) return [...path, item.name];
    onPath.add(id);
    path.push(item.name);
    idPath.push(id);
    for (const line of item.lines) {
      if (line.componentType !== "menuItem") continue;
      const found = walk(line.componentId, depth + 1);
      if (found) return found;
    }
    path.pop();
    idPath.pop();
    onPath.delete(id);
    return null;
  };

  return walk(startId, 0);
}

/** Every menu item that already contains `itemId`, directly or at any depth —
 * adding one of these as a component would close a loop, so the picker greys
 * them out before she can build the mistake. */
export function itemsThatWouldLoop(
  itemId: string,
  items: Record<string, CostingItem>,
): Set<string> {
  const looping = new Set<string>([itemId]);
  const contains = (candidate: string, depth = 0): boolean => {
    if (depth > MAX_DEPTH) return false;
    const item = items[candidate];
    if (!item) return false;
    for (const line of item.lines) {
      if (line.componentType !== "menuItem") continue;
      if (line.componentId === itemId) return true;
      if (contains(line.componentId, depth + 1)) return true;
    }
    return false;
  };
  for (const id of Object.keys(items)) {
    if (id !== itemId && contains(id)) looping.add(id);
  }
  return looping;
}

// --- Formatting helpers used inside the working-out ----------------------

function money(cents: number): string {
  const abs = Math.abs(cents) / 100;
  return `${cents < 0 ? "−" : ""}$${abs.toFixed(2)}`;
}

function qtyLabel(qtyMilli: number, baseUnit: BaseUnit): string {
  const base = qtyMilli / 1000;
  if (baseUnit === "unit") return `${trim(base)}`;
  if (base >= 1000) return `${trim(base / 1000)} ${baseUnit === "g" ? "kg" : "L"}`;
  return `${trim(base)} ${baseUnit}`;
}

function unitPriceLabel(
  centsPerThousand: number,
  baseUnit: BaseUnit,
): string {
  if (baseUnit === "unit") return `${money(centsPerThousand / 1000)} each`;
  return `${money(centsPerThousand)}/${baseUnit === "g" ? "kg" : "L"}`;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// --- The engine -----------------------------------------------------------

interface Resolved {
  variableCentsPerUnit: number;
  minutesPerBatchTotal: number;
  composition: CostLine[];
}

/** Depth-first resolve of one item's per-unit variable cost and total batch
 * minutes, memoised per call so a sub used twice is walked once. */
function resolve(
  itemId: string,
  world: CostingWorld,
  memo: Map<string, Resolved>,
  depth: number,
): Resolved {
  const cached = memo.get(itemId);
  if (cached) return cached;

  const item = world.items[itemId];
  const empty: Resolved = {
    variableCentsPerUnit: 0,
    minutesPerBatchTotal: 0,
    composition: [],
  };
  if (!item || depth > MAX_DEPTH) return empty;

  const yieldUnits = item.baseBatchYield > 0 ? item.baseBatchYield : 1;
  let layer1PerBatch = 0;
  let minutes = item.batchProductionMinutes;
  const composition: CostLine[] = [];

  for (const line of item.lines) {
    if (line.componentType === "ingredient") {
      const ing = world.ingredients[line.componentId];
      if (!ing) continue;
      const cents =
        (line.qtyMilli * ing.standardCostCentsPerThousand) / 1_000_000;
      layer1PerBatch += cents;
      composition.push({
        kind: "ingredient",
        id: ing.id,
        name: ing.name,
        detail: `${qtyLabel(line.qtyMilli, ing.baseUnit)} × ${unitPriceLabel(
          ing.standardCostCentsPerThousand,
          ing.baseUnit,
        )}`,
        centsPerBatch: cents,
        centsPerUnit: cents / yieldUnits,
      });
      continue;
    }

    const sub = world.items[line.componentId];
    if (!sub) continue;
    const subResolved = resolve(line.componentId, world, memo, depth + 1);
    const unitsConsumed = line.qtyMilli / 1000;
    // CONTEXT.md: the sub enters at its per-unit VARIABLE cost × units.
    const cents = subResolved.variableCentsPerUnit * unitsConsumed;
    layer1PerBatch += cents;
    // ...and its batch time in proportion to the batch fraction consumed.
    const subYield = sub.baseBatchYield > 0 ? sub.baseBatchYield : 1;
    minutes += subResolved.minutesPerBatchTotal * (unitsConsumed / subYield);

    composition.push({
      kind: "subRecipe",
      id: sub.id,
      name: sub.name,
      detail: `${trim(unitsConsumed)} ${
        unitsConsumed === 1 ? "unit" : "units"
      } × ${money(subResolved.variableCentsPerUnit)} each ≈ ${trim(
        (unitsConsumed * sub.unitWeightMilligrams) / 1000,
      )} g`,
      centsPerBatch: cents,
      centsPerUnit: cents / yieldUnits,
      children: subResolved.composition,
    });
  }

  const layer2PerUnit = item.perUnitExtras.reduce(
    (sum, extra) => sum + extra.costCents,
    0,
  );

  const result: Resolved = {
    variableCentsPerUnit: layer1PerBatch / yieldUnits + layer2PerUnit,
    minutesPerBatchTotal: minutes,
    composition,
  };
  memo.set(itemId, result);
  return result;
}

export function costItem(itemId: string, world: CostingWorld): Costing {
  const item = world.items[itemId];
  const yieldUnits =
    item && item.baseBatchYield > 0 ? item.baseBatchYield : 1;

  const memo = new Map<string, Resolved>();
  // Resolve the item's own composition without memoising itself, so the
  // top-level numbers are built from the same lines she sees.
  const resolved = item
    ? resolve(itemId, world, memo, 0)
    : { variableCentsPerUnit: 0, minutesPerBatchTotal: 0, composition: [] };

  const layer1PerBatch = resolved.composition.reduce(
    (sum, line) => sum + line.centsPerBatch,
    0,
  );
  const extrasLines: CostLine[] = (item?.perUnitExtras ?? []).map((extra) => ({
    kind: "extra" as const,
    name: extra.label,
    detail: `${money(extra.costCents)} per unit`,
    centsPerBatch: extra.costCents * yieldUnits,
    centsPerUnit: extra.costCents,
  }));
  const layer2PerUnit = extrasLines.reduce((s, l) => s + l.centsPerUnit, 0);

  const ownMinutes = item?.batchProductionMinutes ?? 0;
  const subMinutes = resolved.minutesPerBatchTotal - ownMinutes;
  const rate = world.overheadRateCentsPerHour;
  const overheadPerBatch = (rate * resolved.minutesPerBatchTotal) / 60;

  const timeLines: CostLine[] = [
    {
      kind: "time",
      name: "This recipe",
      detail: `${trim(ownMinutes)} min × ${money(rate)}/hour`,
      centsPerBatch: (rate * ownMinutes) / 60,
      centsPerUnit: (rate * ownMinutes) / 60 / yieldUnits,
    },
  ];
  if (subMinutes > 0.0001) {
    timeLines.push({
      kind: "time",
      name: "Sub-recipes",
      detail: `${trim(Math.round(subMinutes * 10) / 10)} min of their batches`,
      centsPerBatch: (rate * subMinutes) / 60,
      centsPerUnit: (rate * subMinutes) / 60 / yieldUnits,
    });
  }

  const variableCentsPerUnit = layer1PerBatch / yieldUnits + layer2PerUnit;
  const overheadPerUnit = overheadPerBatch / yieldUnits;
  const totalCentsPerUnit = variableCentsPerUnit + overheadPerUnit;

  const priceCents = item?.priceCents ?? null;
  const target = item?.targetGrossMarginPercent ?? null;
  // Multiply before dividing. ((200−87)/200)×100 evaluates to
  // 56.49999999999999 and rounds DOWN to 56; ((200−87)×100)/200 is exactly
  // 56.5 and rounds to 57. A margin sitting on a half-point is not rare, and
  // losing a whole point to float order in an app about telling the truth
  // about numbers is not acceptable.
  const gross =
    priceCents && priceCents > 0
      ? Math.round(((priceCents - variableCentsPerUnit) * 100) / priceCents)
      : null;
  const net =
    priceCents && priceCents > 0
      ? Math.round(((priceCents - totalCentsPerUnit) * 100) / priceCents)
      : null;

  return {
    itemId,
    yieldUnits,
    unitWeightMilligrams: item?.unitWeightMilligrams ?? 0,
    ingredients: {
      centsPerBatch: layer1PerBatch,
      centsPerUnit: layer1PerBatch / yieldUnits,
      lines: resolved.composition,
    },
    extras: {
      centsPerBatch: layer2PerUnit * yieldUnits,
      centsPerUnit: layer2PerUnit,
      lines: extrasLines,
    },
    overhead: {
      centsPerBatch: overheadPerBatch,
      centsPerUnit: overheadPerUnit,
      minutesPerBatch: resolved.minutesPerBatchTotal,
      lines: timeLines,
    },
    variableCentsPerUnit,
    variableCentsPerBatch: variableCentsPerUnit * yieldUnits,
    totalCentsPerUnit,
    totalCentsPerBatch: totalCentsPerUnit * yieldUnits,
    priceCents,
    grossMarginPercent: gross,
    netMarginPercent: net,
    targetGrossMarginPercent: target,
    belowTarget: gross !== null && target !== null && gross < target,
  };
}

/**
 * Changing yield models cutting the SAME tray differently, so total mass is
 * constant: unit weight follows as old × (oldYield ÷ newYield). Pre-filled
 * and editable — this is a suggestion, not a lock (CONTEXT.md).
 */
export function rescaleUnitWeight(
  currentMilligrams: number,
  oldYield: number,
  newYield: number,
): number {
  if (oldYield <= 0 || newYield <= 0) return currentMilligrams;
  return Math.round((currentMilligrams * oldYield) / newYield);
}

/** Which menu items use this one, and how much of it they take. */
export function usedBy(
  itemId: string,
  items: Record<string, CostingItem>,
): { id: string; name: string; unitsConsumed: number }[] {
  const out: { id: string; name: string; unitsConsumed: number }[] = [];
  for (const item of Object.values(items)) {
    const units = item.lines
      .filter((l) => l.componentType === "menuItem" && l.componentId === itemId)
      .reduce((sum, l) => sum + l.qtyMilli / 1000, 0);
    if (units > 0) out.push({ id: item.id, name: item.name, unitsConsumed: units });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
