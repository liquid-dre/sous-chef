import type { CostingWorld } from "./costing";

/**
 * What a bake will actually consume, resolved through nested sub-recipes.
 *
 * This is the one thing Sous has never been able to work out. Three places
 * multiply a recipe quantity by a batch count — production.ts:396,
 * production.ts:425, dashboard.ts:238 — and every one of them is a single
 * level deep, because DEDUCTION must never recurse: moving flour without a
 * production log behind it would leave a batch of buttercream with no cost
 * snapshot, no yield variance and no overhang (CONTEXT.md — Pantry).
 *
 * Forecasting is a different act, and it is allowed to look further ahead.
 * But it has to look ahead at the RIGHT thing, and the whole value of this
 * module is that it walks the tree the same way the deduction will:
 *
 *   1. A sub-recipe line draws on the sub's FINISHED stock first.
 *   2. Only the shortfall becomes batches of the sub — WHOLE batches, because
 *      that is the only thing she can log (CONTEXT.md — Base batch).
 *   3. Only those batches consume the sub's own ingredients.
 *
 * Get step 1 wrong and Sous warns about butter while six units of buttercream
 * sit on the shelf. Get step 2 wrong and it under-orders by the rounding.
 * Either is a confident wrong alert, and CONTEXT.md is explicit that two of
 * those and she mutes the system forever. So the forecast is not "close
 * enough" arithmetic — it predicts exactly what the deduction will do.
 *
 * Pure: no Convex, no clock. `loadWorld` (convex/lib/world.ts) already puts
 * the entire quantity graph in memory in one call, so this needs no reads.
 */

/** The same ceiling costing.ts uses. A recipe nested deeper than this is a
 * data error, and the answer is to stop rather than to recurse forever. */
const MAX_DEPTH = 16;

export interface Requirement {
  /** Milli-base-units of each raw ingredient the bake will consume. */
  ingredientMilli: Map<string, number>;
  /**
   * Batches of each sub-recipe that would have to be made, keyed by menu item
   * id. This is what the "log a buttercream batch too?" prompt is built from,
   * and what makes the forecast auditable — she can see WHY butter is needed.
   */
  subBatches: Map<string, number>;
  /** True when the walk hit MAX_DEPTH. Everything below that point is
   * missing from the figures, and a caller that hides this would be
   * publishing a number it cannot stand behind. */
  truncated: boolean;
}

function emptyRequirement(): Requirement {
  return {
    ingredientMilli: new Map(),
    subBatches: new Map(),
    truncated: false,
  };
}

function add(into: Map<string, number>, key: string, amount: number) {
  into.set(key, (into.get(key) ?? 0) + amount);
}

/**
 * What `batchCount` batches of `itemId` will consume.
 *
 * `subStockMilli` is READ AND MUTATED: finished units of a sub that this bake
 * claims are removed from it, so a second call against the same map cannot
 * spend the same buttercream twice. That is not a side effect to tidy away —
 * it is how two orders in the same window are stopped from each believing the
 * shelf covers them. Callers wanting an untouched map pass a copy.
 */
export function requiredFor(
  itemId: string,
  batchCount: number,
  world: CostingWorld,
  subStockMilli: Map<string, number>,
  depth = 0,
): Requirement {
  const out = emptyRequirement();
  if (batchCount <= 0) return out;
  if (depth >= MAX_DEPTH) {
    out.truncated = true;
    return out;
  }

  const item = world.items[itemId];
  if (!item) return out;

  for (const line of item.lines) {
    if (line.componentType === "ingredient") {
      // The leaf. Exactly production.ts:396's arithmetic.
      add(
        out.ingredientMilli,
        line.componentId,
        Math.round(line.qtyMilli * batchCount),
      );
      continue;
    }

    const sub = world.items[line.componentId];
    if (!sub) continue;

    const neededMilli = Math.round(line.qtyMilli * batchCount);

    // Step 1: the shelf. `planSellDown` does this against real production
    // logs at write time; here it is a running total, which is the same
    // FIFO answer in aggregate because every unit of the sub is
    // interchangeable for the purpose of "will it cover this".
    const onHandMilli = subStockMilli.get(line.componentId) ?? 0;
    const takenMilli = Math.min(onHandMilli, neededMilli);
    if (takenMilli > 0) subStockMilli.set(line.componentId, onHandMilli - takenMilli);

    const shortMilli = neededMilli - takenMilli;
    if (shortMilli <= 0) continue; // The shelf covered it. Nothing else moves.

    // Step 2: whole batches only. She cannot log two thirds of a tray, so a
    // forecast that asks for 0.8 batches of butter is describing an event
    // that cannot happen.
    const yieldUnits = sub.baseBatchYield > 0 ? sub.baseBatchYield : 1;
    const subBatches = Math.ceil(shortMilli / 1000 / yieldUnits);
    add(out.subBatches, line.componentId, subBatches);

    // Step 3: what those batches consume. Recursing HERE — and only here —
    // is the honest expansion, because in the real world these batches will
    // be logged and will write their own movements.
    const nested = requiredFor(
      line.componentId,
      subBatches,
      world,
      subStockMilli,
      depth + 1,
    );
    for (const [id, milli] of nested.ingredientMilli) {
      add(out.ingredientMilli, id, milli);
    }
    for (const [id, batches] of nested.subBatches) {
      add(out.subBatches, id, batches);
    }
    if (nested.truncated) out.truncated = true;

    // A batch usually makes more than the shortfall needed. That surplus is
    // real — it will be overhang the moment she logs it — so it goes back on
    // the shelf for whatever asks next, exactly as production.log books it.
    const madeMilli = subBatches * yieldUnits * 1000;
    const surplusMilli = madeMilli - shortMilli;
    if (surplusMilli > 0) {
      add(subStockMilli, line.componentId, surplusMilli);
    }
  }

  return out;
}

/**
 * The same walk over a whole order book, sharing ONE shelf.
 *
 * Sharing the map is the entire point: three orders in the same week draw on
 * the same buttercream, and summing them independently would let each one
 * believe the shelf covers it. Ordered lowest-batch-first so the arithmetic
 * is deterministic regardless of how the caller happened to sort orders — an
 * alert that changed severity because two orders swapped places would be
 * impossible to trust.
 */
export function requiredForAll(
  demands: readonly { itemId: string; batchCount: number }[],
  world: CostingWorld,
  subStockMilli: Map<string, number>,
): Requirement {
  const out = emptyRequirement();
  const ordered = [...demands].sort(
    (a, b) => a.batchCount - b.batchCount || a.itemId.localeCompare(b.itemId),
  );
  for (const demand of ordered) {
    const one = requiredFor(demand.itemId, demand.batchCount, world, subStockMilli);
    for (const [id, milli] of one.ingredientMilli) add(out.ingredientMilli, id, milli);
    for (const [id, batches] of one.subBatches) add(out.subBatches, id, batches);
    if (one.truncated) out.truncated = true;
  }
  return out;
}

/**
 * Whole batches of `itemId` needed to cover `unitsMilli` finished units.
 *
 * Shared by the alert engine and anything else that has to turn an order line
 * into a bake. `whatNeedsMaking` computes the same figure inline
 * (production.ts:664) — this is that arithmetic, named.
 */
export function batchesFor(unitsMilli: number, baseBatchYield: number): number {
  const perBatch = baseBatchYield > 0 ? baseBatchYield : 1;
  return Math.max(0, Math.ceil(unitsMilli / 1000 / perBatch));
}
