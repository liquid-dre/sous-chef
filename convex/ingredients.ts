import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ownerMutation,
  ownerQuery,
  type MutationCtx,
  type QueryCtx,
} from "./lib/functions";
import {
  driftFor,
  isPackUnitCompatible,
  MIN_PURCHASES_FOR_DRIFT,
  needsAttention,
  type BaseUnit,
  type Drift,
} from "./lib/drift";
import { levelOf, pantryConfidence } from "./stock";

/**
 * The pantry. Owner-only throughout — these carry costs.
 *
 * Drift is computed here on demand, never stored: adopting the median makes
 * the signal disappear because the inputs changed, not because a row was
 * resolved (see convex/lib/drift.ts).
 */

const baseUnitValidator = v.union(
  v.literal("g"),
  v.literal("ml"),
  v.literal("unit"),
);

const DRIFT_WINDOW = MIN_PURCHASES_FOR_DRIFT;

/** Last N unit prices for an ingredient, newest first. */
async function recentUnitPrices(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  ingredientId: Id<"ingredients">,
  limit = DRIFT_WINDOW,
): Promise<number[]> {
  const rows = await ctx.db
    .query("purchases")
    .withIndex("by_org_ingredient_time", (q) =>
      q.eq("orgId", orgId).eq("ingredientId", ingredientId),
    )
    .order("desc")
    .take(limit);
  return rows.map((p) => p.unitPriceCentsPerThousand);
}

async function driftForIngredient(
  ctx: QueryCtx | MutationCtx,
  ingredient: Doc<"ingredients">,
  thresholdPercent: number,
): Promise<Drift> {
  return driftFor({
    standardCostCentsPerThousand: ingredient.standardCostCentsPerThousand,
    standardCostSetAt: ingredient.standardCostSetAt,
    recentUnitPrices: await recentUnitPrices(
      ctx,
      ingredient.orgId,
      ingredient._id,
    ),
    thresholdPercent,
    now: Date.now(),
  });
}

/**
 * The pantry list: each row's drift, each row's derived level, and how much
 * of any of it Sous is willing to stand behind.
 *
 * `today` is HERS and arrives from the client (components/use-client-today):
 * whether the weekly count was missed is a question about her week, and
 * Convex runs UTC (lib/day.ts).
 */
export const list = ownerQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const threshold = ctx.org?.costDriftThresholdPercent ?? 10;
    const ingredients = await ctx.db
      .query("ingredients")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();

    const rows = await Promise.all(
      ingredients.map(async (ingredient) => {
        const drift = await driftForIngredient(ctx, ingredient, threshold);
        // Derived, never stored (convex/lib/stock.ts). Null for
        // don't-track-stock ingredients: salt and foil are costed and never
        // counted, so there is no figure rather than a zero that would read
        // as "you have run out".
        const stock = ingredient.trackStock
          ? await levelOf(ctx, ingredient)
          : null;
        return {
          id: ingredient._id,
          name: ingredient.name,
          baseUnit: ingredient.baseUnit as BaseUnit,
          standardCostCentsPerThousand: ingredient.standardCostCentsPerThousand,
          standardCostSetAt: ingredient.standardCostSetAt,
          trackStock: ingredient.trackStock,
          levelMilli: stock?.levelMilli ?? null,
          /** When it was last physically COUNTED. Null = never. */
          countedAt: stock?.anchor?.takenAt ?? null,
          alertsMuted: ingredient.alertsMuted,
          drift,
          needsAttention: needsAttention(drift, ingredient.alertsMuted),
        };
      }),
    );
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return {
      rows,
      thresholdPercent: threshold,
      /** Drives the charts' empty state: nothing has three purchases yet, so
       * no drift can be computed for anything — say that plainly rather than
       * drawing an empty axis. */
      anyDriftComputable: rows.some((r) => r.drift.hasEnoughData),
      /** fresh / stale / dormant / never counted. Derived at read time, never
       * an alert row: the moment it becomes a document it can be stale in a
       * second way, and there is no cron to keep it honest. */
      confidence: await pantryConfidence(
        ctx,
        ctx.orgId,
        today,
        ctx.org?.stocktakeDay ?? null,
      ),
    };
  },
});

/** Ingredient detail: drift plus the full price history for the line chart. */
export const get = ownerQuery({
  args: { ingredientId: v.id("ingredients") },
  handler: async (ctx, { ingredientId }) => {
    const ingredient = await ctx.db.get(ingredientId);
    if (!ingredient || ingredient.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const threshold = ctx.org?.costDriftThresholdPercent ?? 10;
    const drift = await driftForIngredient(ctx, ingredient, threshold);

    const purchases = await ctx.db
      .query("purchases")
      .withIndex("by_org_ingredient_time", (q) =>
        q.eq("orgId", ctx.orgId).eq("ingredientId", ingredientId),
      )
      .order("desc")
      .take(60);

    const stock = ingredient.trackStock ? await levelOf(ctx, ingredient) : null;

    const standard = ingredient.standardCostCentsPerThousand;
    return {
      id: ingredient._id,
      name: ingredient.name,
      baseUnit: ingredient.baseUnit as BaseUnit,
      standardCostCentsPerThousand: standard,
      standardCostSetAt: ingredient.standardCostSetAt,
      trackStock: ingredient.trackStock,
      levelMilli: stock?.levelMilli ?? null,
      countedAt: stock?.anchor?.takenAt ?? null,
      countedQtyMilli: stock?.anchor?.countedQtyMilli ?? null,
      alertsMuted: ingredient.alertsMuted,
      drift,
      /** Oldest first, as the chart reads. `percentFromStandard` is what the
       * line plots — zero means "exactly on standard cost", which is why the
       * axis can be honestly zero-anchored (DESIGN.md §5). */
      history: purchases
        .slice()
        .reverse()
        .map((p) => ({
          purchasedAt: p.purchasedAt,
          unitPriceCentsPerThousand: p.unitPriceCentsPerThousand,
          percentFromStandard:
            standard > 0
              ? Math.round(
                  ((p.unitPriceCentsPerThousand - standard) / standard) * 100,
                )
              : 0,
          priceCents: p.priceCents,
          packQtyMilli: p.packQtyMilli,
          packUnit: p.packUnit,
        })),
    };
  },
});

/** Type-ahead source for purchase entry and the recipe builder. */
export const search = ownerQuery({
  args: { term: v.string() },
  handler: async (ctx, { term }) => {
    const all = await ctx.db
      .query("ingredients")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    const needle = term.trim().toLowerCase();
    return all
      .filter((i) => !needle || i.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((i) => ({
        id: i._id,
        name: i.name,
        baseUnit: i.baseUnit as BaseUnit,
        standardCostCentsPerThousand: i.standardCostCentsPerThousand,
      }));
  },
});

export const create = ownerMutation({
  args: {
    name: v.string(),
    baseUnit: baseUnitValidator,
    standardCostCentsPerThousand: v.number(),
    trackStock: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await createIngredient(ctx, ctx.orgId, args);
  },
});

/** Shared with purchase entry's inline create. */
export async function createIngredient(
  ctx: MutationCtx,
  orgId: string,
  args: {
    name: string;
    baseUnit: BaseUnit;
    standardCostCentsPerThousand: number;
    trackStock?: boolean;
  },
): Promise<Id<"ingredients">> {
  const name = args.name.trim();
  if (name === "") throw new Error("An ingredient needs a name.");
  if (args.standardCostCentsPerThousand < 0) {
    throw new Error("Standard cost can't be negative.");
  }
  return await ctx.db.insert("ingredients", {
    orgId,
    name,
    baseUnit: args.baseUnit,
    standardCostCentsPerThousand: Math.round(args.standardCostCentsPerThousand),
    standardCostSetAt: Date.now(),
    trackStock: args.trackStock ?? true,
    // No level to seed — there is no stored level. A brand-new ingredient
    // has an empty ledger, and an empty ledger sums to zero all by itself.
    alertsMuted: false,
  });
}

/** Has anything committed to this ingredient's unit meaning yet? */
async function isBaseUnitLocked(
  ctx: MutationCtx,
  orgId: string,
  ingredientId: Id<"ingredients">,
): Promise<boolean> {
  const recipeLine = await ctx.db
    .query("recipeLines")
    .withIndex("by_org_component", (q) =>
      q
        .eq("orgId", orgId)
        .eq("componentType", "ingredient")
        .eq("componentId", ingredientId),
    )
    .first();
  if (recipeLine) return true;
  const purchase = await ctx.db
    .query("purchases")
    .withIndex("by_org_ingredient_time", (q) =>
      q.eq("orgId", orgId).eq("ingredientId", ingredientId),
    )
    .first();
  if (purchase) return true;
  const movement = await ctx.db
    .query("stockMovements")
    .withIndex("by_org_ingredient_time", (q) =>
      q.eq("orgId", orgId).eq("ingredientId", ingredientId),
    )
    .first();
  return movement !== null;
}

export const update = ownerMutation({
  args: {
    ingredientId: v.id("ingredients"),
    name: v.optional(v.string()),
    baseUnit: v.optional(baseUnitValidator),
    standardCostCentsPerThousand: v.optional(v.number()),
    trackStock: v.optional(v.boolean()),
    alertsMuted: v.optional(v.boolean()),
  },
  handler: async (ctx, { ingredientId, ...args }) => {
    const ingredient = await ctx.db.get(ingredientId);
    if (!ingredient || ingredient.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const patch: Record<string, unknown> = {};

    if (args.name !== undefined) {
      if (args.name.trim() === "") throw new Error("An ingredient needs a name.");
      patch.name = args.name.trim();
    }
    if (args.baseUnit !== undefined && args.baseUnit !== ingredient.baseUnit) {
      // Changing what stored quantities MEAN is corruption, not an edit.
      if (await isBaseUnitLocked(ctx, ctx.orgId, ingredientId)) {
        throw new Error(
          "This ingredient is already used in recipes or purchases, so its unit can't change.",
        );
      }
      patch.baseUnit = args.baseUnit;
    }
    if (args.standardCostCentsPerThousand !== undefined) {
      if (args.standardCostCentsPerThousand < 0) {
        throw new Error("Standard cost can't be negative.");
      }
      patch.standardCostCentsPerThousand = Math.round(
        args.standardCostCentsPerThousand,
      );
      patch.standardCostSetAt = Date.now();
    }
    if (args.trackStock !== undefined) patch.trackStock = args.trackStock;
    if (args.alertsMuted !== undefined) patch.alertsMuted = args.alertsMuted;

    await ctx.db.patch(ingredientId, patch);
    return null;
  },
});

/**
 * Adopt the median of the last three purchases as the new standard cost.
 *
 * Historical orderLine cogsSnapshots are NOT touched — they were stamped at
 * sale and stay byte-identical, which convex/pantry.test.ts asserts
 * explicitly. Only future costings move.
 */
export const adoptMedian = ownerMutation({
  args: { ingredientId: v.id("ingredients") },
  handler: async (ctx, { ingredientId }) => {
    const ingredient = await ctx.db.get(ingredientId);
    if (!ingredient || ingredient.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const drift = await driftForIngredient(
      ctx,
      ingredient,
      ctx.org?.costDriftThresholdPercent ?? 10,
    );
    if (!drift.hasEnoughData || drift.medianCentsPerThousand === null) {
      throw new Error(
        `Sous needs ${MIN_PURCHASES_FOR_DRIFT} purchases before it can suggest a cost.`,
      );
    }
    await ctx.db.patch(ingredientId, {
      standardCostCentsPerThousand: drift.medianCentsPerThousand,
      standardCostSetAt: Date.now(),
    });
    return { adoptedCentsPerThousand: drift.medianCentsPerThousand };
  },
});

export { isPackUnitCompatible };
