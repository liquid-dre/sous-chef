import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { orgQuery, ownerMutation, ownerQuery } from "./lib/functions";
import { sensoryAxis } from "./schema";
import { driftFor, type Drift } from "./lib/drift";
import {
  costItem,
  findCycle,
  itemsThatWouldLoop,
  usedBy,
  type CostingWorld,
} from "./lib/costing";
import { loadWorld } from "./lib/world";
import { summarise, warningsFor, type FeedbackRow } from "./lib/feedback";
import { batchFacts, portionRatings } from "./lib/portionAdapters";
import {
  evidenceFor,
  reportFor,
  type OverrideReport,
  type PortionEvidence,
} from "./lib/portionEvidence";

/**
 * Menu items: recipe + price + target margin, one entity. A sub-recipe is a
 * menu item flagged notSoldDirectly.
 *
 * All costing goes through convex/lib/costing.ts — the same pure module the
 * builder runs against unsaved form state, so what she watches while typing
 * and what the server stores can never disagree.
 */

const lineValidator = v.object({
  componentType: v.union(v.literal("ingredient"), v.literal("menuItem")),
  componentId: v.string(),
  qtyMilli: v.number(),
  unit: v.union(v.literal("g"), v.literal("ml"), v.literal("unit")),
});

const extrasValidator = v.array(
  v.object({ label: v.string(), costCents: v.number() }),
);

/** The menu screen: every item with its costing. */
export const list = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const world = await loadWorld(ctx);
    const rows = Object.values(world.items)
      .map((item) => {
        const costing = costItem(item.id, world);
        return {
          id: item.id,
          name: item.name,
          notSoldDirectly: item.notSoldDirectly,
          priceCents: item.priceCents ?? null,
          yieldUnits: item.baseBatchYield,
          unitWeightMilligrams: item.unitWeightMilligrams,
          variableCentsPerUnit: costing.variableCentsPerUnit,
          totalCentsPerUnit: costing.totalCentsPerUnit,
          grossMarginPercent: costing.grossMarginPercent,
          netMarginPercent: costing.netMarginPercent,
          targetGrossMarginPercent: costing.targetGrossMarginPercent,
          belowTarget: costing.belowTarget,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { rows };
  },
});

/**
 * The menu as staff see it. Menu is in the staff nav (CONTEXT.md — Routes),
 * but costs and margins are owner-only, so this is a separate query that
 * cannot leak them rather than a filtered version of `list`. Gating happens
 * server-side; nothing is hidden with CSS.
 */
export const listForKitchen = orgQuery({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();
    return items
      .map((item) => ({
        id: item._id,
        name: item.name,
        notSoldDirectly: item.notSoldDirectly,
        priceCents: item.priceCents ?? null,
        baseBatchYield: item.baseBatchYield,
        leadTimeHours: item.leadTimeHours ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** The builder's entire payload: the item, the world it costs against, and
 * which components would loop. One round trip. */
export const getForBuilder = ownerQuery({
  args: { menuItemId: v.optional(v.id("menuItems")) },
  handler: async (ctx, { menuItemId }) => {
    const world = await loadWorld(ctx);

    let item: Doc<"menuItems"> | null = null;
    if (menuItemId) {
      item = await ctx.db.get(menuItemId);
      if (!item || item.orgId !== ctx.orgId) {
        throw new ConvexError({ code: "NOT_FOUND" as const });
      }
    }

    const drifts: Record<string, Drift> = {};
    const threshold = ctx.org?.costDriftThresholdPercent ?? 10;
    const now = Date.now();
    for (const ingredientId of Object.keys(world.ingredients)) {
      const row = await ctx.db.get(ingredientId as Id<"ingredients">);
      if (!row) continue;
      const recent = await ctx.db
        .query("purchases")
        .withIndex("by_org_ingredient_time", (q) =>
          q.eq("orgId", ctx.orgId).eq("ingredientId", row._id),
        )
        .order("desc")
        .take(3);
      drifts[ingredientId] = driftFor({
        standardCostCentsPerThousand: row.standardCostCentsPerThousand,
        standardCostSetAt: row.standardCostSetAt,
        recentUnitPrices: recent.map((p) => p.unitPriceCentsPerThousand),
        thresholdPercent: threshold,
        now,
      });
    }

    // The optimiser's yield lever can shrink a product until it is not worth
    // buying, and the one thing standing in its way is customers saying it is
    // already too small. This is where they get heard — and since this slice,
    // heard about a SIZE rather than about the item in general.
    let feedbackWarnings: ReturnType<typeof warningsFor> = [];
    let portionEvidence: PortionEvidence | null = null;
    let overrideReport: OverrideReport | null = null;
    let overriddenYields: number[] = [];
    if (item) {
      const rows = await ctx.db
        .query("feedback")
        .withIndex("by_org_menuItem", (q) =>
          q.eq("orgId", ctx.orgId).eq("menuItemId", item._id),
        )
        .collect();
      feedbackWarnings = warningsFor(summarise(item.sensoryAxes, rows as FeedbackRow[]));

      const logs = await ctx.db
        .query("productionLogs")
        .withIndex("by_org_menuItem", (q) =>
          q.eq("orgId", ctx.orgId).eq("menuItemId", item._id),
        )
        .collect();
      const overrides = await ctx.db
        .query("optimiserOverrides")
        .withIndex("by_org_item", (q) =>
          q.eq("orgId", ctx.orgId).eq("menuItemId", item._id),
        )
        .collect();
      overriddenYields = overrides.map((o) => o.yieldUnits);

      const ratings = portionRatings(rows);
      const batches = batchFacts(logs);
      portionEvidence = evidenceFor(ratings, batches);

      // The report replaces the warning for the size she already decided
      // about, so it is built only for the yield she is on right now.
      const here = overrides.find((o) => o.yieldUnits === item.baseBatchYield);
      if (here) {
        const costing = costItem(item._id, world);
        overrideReport = reportFor(
          ratings,
          batches,
          {
            yieldUnits: here.yieldUnits,
            decidedAt: here.decidedAt,
            saidTooSmallAtDecision: here.saidTooSmallAtDecision,
            sampleAtDecision: here.sampleAtDecision,
            grossMarginPercentAtDecision: here.grossMarginPercentAtDecision ?? null,
          },
          costing.grossMarginPercent,
        );
      }
    }

    return {
      feedbackWarnings,
      portionEvidence,
      overrideReport,
      /** Sizes she has already decided about. The warning is silent at these
       * and at no others (schema.ts — optimiserOverrides). */
      overriddenYields,
      item: item
        ? {
            id: item._id,
            name: item.name,
            notSoldDirectly: item.notSoldDirectly,
            baseBatchYield: item.baseBatchYield,
            unitWeightMilligrams: item.unitWeightMilligrams,
            unitWeightFloorMilligrams: item.unitWeightFloorMilligrams ?? null,
            batchProductionMinutes: item.batchProductionMinutes,
            perUnitExtras: item.perUnitExtras,
            priceCents: item.priceCents ?? null,
            targetGrossMarginPercent: item.targetGrossMarginPercent ?? null,
            minPriceCents: item.minPriceCents ?? null,
            maxPriceCents: item.maxPriceCents ?? null,
            minYield: item.minYield ?? null,
            maxYield: item.maxYield ?? null,
            constraintNote: item.constraintNote ?? null,
            optimiserSetAsideAt: item.optimiserSetAsideAt ?? null,
            optimiserSetAsideMarginPercent:
              item.optimiserSetAsideMarginPercent ?? null,
            leadTimeHours: item.leadTimeHours ?? null,
            shelfLifeHours: item.shelfLifeHours ?? null,
            sensoryAxes: item.sensoryAxes,
            lines: world.items[item._id]?.lines ?? [],
          }
        : null,
      world: {
        items: world.items,
        ingredients: world.ingredients,
        overheadRateCentsPerHour: world.overheadRateCentsPerHour,
      },
      drifts,
      wouldLoop: menuItemId
        ? [...itemsThatWouldLoop(menuItemId, world.items)]
        : [],
      usedBy: menuItemId ? usedBy(menuItemId, world.items) : [],
    };
  },
});

/** Any limit set demands a reason — a limit without one rots, and future-her
 * will not remember why the ceiling was $4. The limits themselves only ever
 * flag her; they bind the optimiser, never the save. */
function assertConstraintNote(args: {
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  minYield?: number | null;
  maxYield?: number | null;
  unitWeightFloorMilligrams?: number | null;
  constraintNote?: string | null;
}) {
  const hasLimit =
    args.minPriceCents != null ||
    args.maxPriceCents != null ||
    args.minYield != null ||
    args.maxYield != null ||
    args.unitWeightFloorMilligrams != null;
  if (hasLimit && !args.constraintNote?.trim()) {
    throw new Error(
      "Say why the limit is there — a limit without a reason won't mean anything in six months.",
    );
  }
}

const saveArgs = {
  menuItemId: v.optional(v.id("menuItems")),
  name: v.string(),
  notSoldDirectly: v.boolean(),
  baseBatchYield: v.number(),
  unitWeightMilligrams: v.number(),
  batchProductionMinutes: v.number(),
  perUnitExtras: extrasValidator,
  lines: v.array(lineValidator),
  priceCents: v.optional(v.union(v.number(), v.null())),
  targetGrossMarginPercent: v.optional(v.union(v.number(), v.null())),
  minPriceCents: v.optional(v.union(v.number(), v.null())),
  maxPriceCents: v.optional(v.union(v.number(), v.null())),
  minYield: v.optional(v.union(v.number(), v.null())),
  maxYield: v.optional(v.union(v.number(), v.null())),
  unitWeightFloorMilligrams: v.optional(v.union(v.number(), v.null())),
  constraintNote: v.optional(v.union(v.string(), v.null())),
  leadTimeHours: v.optional(v.union(v.number(), v.null())),
  shelfLifeHours: v.optional(v.union(v.number(), v.null())),
  /** The dimensions customers are asked to rate. Absent leaves them alone. */
  sensoryAxes: v.optional(v.array(sensoryAxis)),
};

/**
 * Zero, or two to four. Never one.
 *
 * Zero is the state every item is in until she picks — silence, not an
 * assertion. One is not a profile: a radar with one axis is a spoke, and a
 * single dimension tells her nothing she could not have asked directly. The
 * upper bound is CONTEXT.md's, and it is about the form: seven sliders on a
 * phone is a survey, and a survey does not get answered.
 */
function assertAxisCount(axes: string[] | undefined) {
  if (axes === undefined) return;
  const unique = new Set(axes);
  if (unique.size !== axes.length) {
    throw new Error("Each axis can only be picked once.");
  }
  if (axes.length === 1 || axes.length > 4) {
    throw new Error("Pick two to four things to ask about, or none at all.");
  }
}

export const save = ownerMutation({
  args: saveArgs,
  handler: async (ctx, args) => {
    if (args.name.trim() === "") throw new Error("A menu item needs a name.");
    if (!Number.isFinite(args.baseBatchYield) || args.baseBatchYield <= 0) {
      throw new Error("A batch has to yield at least one unit.");
    }
    if (args.unitWeightMilligrams <= 0) {
      throw new Error("Unit weight is required — it guards the optimiser.");
    }
    if (!args.notSoldDirectly && args.shelfLifeHours == null) {
      throw new Error("Anything you sell needs a shelf life.");
    }
    assertConstraintNote(args);
    assertAxisCount(args.sensoryAxes);

    // The price BEFORE this save, so priceSetAt can be written only when the
    // price actually moved. costedAt below is the counter-example: it is
    // bumped by every save, which is why nothing reads it.
    const previous = args.menuItemId ? await ctx.db.get(args.menuItemId) : null;
    if (args.menuItemId && (!previous || previous.orgId !== ctx.orgId)) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const nextPriceCents = args.notSoldDirectly
      ? undefined
      : (args.priceCents ?? undefined);
    const priceMoved = previous
      ? (previous.priceCents ?? undefined) !== nextPriceCents
      : nextPriceCents !== undefined;

    const fields = {
      orgId: ctx.orgId,
      name: args.name.trim(),
      notSoldDirectly: args.notSoldDirectly,
      baseBatchYield: Math.round(args.baseBatchYield),
      unitWeightMilligrams: Math.round(args.unitWeightMilligrams),
      batchProductionMinutes: Math.max(0, args.batchProductionMinutes),
      perUnitExtras: args.perUnitExtras,
      // Sub-recipes carry no price or target — the parent holds the margin.
      ...(args.notSoldDirectly
        ? { priceCents: undefined, targetGrossMarginPercent: undefined }
        : {
            priceCents: nextPriceCents,
            targetGrossMarginPercent: args.targetGrossMarginPercent ?? undefined,
          }),
      // Untouched when the price did not move, so re-saving a recipe does not
      // reset the clock on how long the price has stood.
      ...(priceMoved
        ? { priceSetAt: nextPriceCents === undefined ? undefined : Date.now() }
        : {}),
      minPriceCents: args.minPriceCents ?? undefined,
      maxPriceCents: args.maxPriceCents ?? undefined,
      minYield: args.minYield ?? undefined,
      maxYield: args.maxYield ?? undefined,
      unitWeightFloorMilligrams: args.unitWeightFloorMilligrams ?? undefined,
      constraintNote: args.constraintNote?.trim() || undefined,
      leadTimeHours: args.leadTimeHours ?? undefined,
      shelfLifeHours: args.shelfLifeHours ?? undefined,
      // Absent leaves them alone, so a caller that does not own the picker
      // cannot wipe them by omission.
      ...(args.sensoryAxes ? { sensoryAxes: args.sensoryAxes } : {}),
      costedAt: Date.now(),
    };

    // patch is partial, so only the insert needs a default for the fields
    // the caller may omit.
    const menuItemId =
      args.menuItemId ??
      (await ctx.db.insert("menuItems", { sensoryAxes: [], ...fields }));
    if (args.menuItemId) await ctx.db.patch(args.menuItemId, fields);

    // Replace the recipe wholesale — simpler than diffing, and the builder
    // always sends the complete set.
    const existing = await ctx.db
      .query("recipeLines")
      .withIndex("by_org_menuItem", (q) =>
        q.eq("orgId", ctx.orgId).eq("menuItemId", menuItemId),
      )
      .collect();
    for (const line of existing) await ctx.db.delete(line._id);
    for (const line of args.lines) {
      if (line.qtyMilli <= 0) continue;
      await ctx.db.insert("recipeLines", {
        orgId: ctx.orgId,
        menuItemId,
        componentType: line.componentType,
        componentId: line.componentId as Id<"ingredients"> | Id<"menuItems">,
        qtyMilli: line.qtyMilli,
        unit: line.unit,
      });
    }

    // The backstop. The picker greys out looping components, but a second
    // tab or a direct call must still be refused — and a cycle is unbounded
    // recursion in the cost engine, so this cannot be advisory.
    const world = await loadWorld(ctx);
    const cycle = findCycle(menuItemId, world.items);
    if (cycle) {
      // Convex rolls the whole mutation back on throw, so the bad recipe
      // never lands.
      throw new ConvexError({
        code: "RECIPE_CYCLE" as const,
        message: `This recipe would contain itself: ${cycle.join(" → ")}.`,
      });
    }

    return { menuItemId };
  },
});

export const remove = ownerMutation({
  args: { menuItemId: v.id("menuItems") },
  handler: async (ctx, { menuItemId }) => {
    const item = await ctx.db.get(menuItemId);
    if (!item || item.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const world = await loadWorld(ctx);
    const parents = usedBy(menuItemId, world.items);
    if (parents.length > 0) {
      throw new Error(
        `${item.name} is used in ${parents.map((p) => p.name).join(", ")}. Take it out of those first.`,
      );
    }
    const lines = await ctx.db
      .query("recipeLines")
      .withIndex("by_org_menuItem", (q) =>
        q.eq("orgId", ctx.orgId).eq("menuItemId", menuItemId),
      )
      .collect();
    for (const line of lines) await ctx.db.delete(line._id);
    await ctx.db.delete(menuItemId);
    return null;
  },
});

/**
 * She set the optimiser aside for this item, or picked it back up.
 *
 * Nothing is deleted and nothing stops computing — the panel still knows the
 * arithmetic, it just stops asserting it, exactly as ingredients.alertsMuted
 * works for drift. Passing a null margin picks it back up.
 *
 * The margin is stored because "Sous records that as her decision" has to mean
 * a record. A bare boolean would leave nothing to answer "why is this at 40%?"
 * in six months.
 */
export const setAsideOptimiser = ownerMutation({
  args: {
    menuItemId: v.id("menuItems"),
    /** The margin she is choosing to ship at. Null picks the panel back up. */
    marginPercent: v.union(v.number(), v.null()),
  },
  handler: async (ctx, { menuItemId, marginPercent }) => {
    const item = await ctx.db.get(menuItemId);
    if (!item || item.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    await ctx.db.patch(menuItemId, {
      optimiserSetAsideAt: marginPercent == null ? undefined : Date.now(),
      optimiserSetAsideMarginPercent:
        marginPercent == null ? undefined : Math.round(marginPercent),
    });
    return null;
  },
});

/**
 * Menu items a cost drift reaches, with margin now vs if she adopted every
 * drifted price at once. Runs on the same engine as the builder, so the
 * numbers agree.
 */
export const driftAffected = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const threshold = ctx.org?.costDriftThresholdPercent ?? 10;
    const now = Date.now();
    const world = await loadWorld(ctx);

    const ingredients = await ctx.db
      .query("ingredients")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();

    const drifted = new Map<string, Drift>();
    for (const ingredient of ingredients) {
      const recent = await ctx.db
        .query("purchases")
        .withIndex("by_org_ingredient_time", (q) =>
          q.eq("orgId", ctx.orgId).eq("ingredientId", ingredient._id),
        )
        .order("desc")
        .take(3);
      const drift = driftFor({
        standardCostCentsPerThousand: ingredient.standardCostCentsPerThousand,
        standardCostSetAt: ingredient.standardCostSetAt,
        recentUnitPrices: recent.map((p) => p.unitPriceCentsPerThousand),
        thresholdPercent: threshold,
        now,
      });
      if (drift.drifted && !ingredient.alertsMuted) {
        drifted.set(ingredient._id, drift);
      }
    }
    if (drifted.size === 0) return { items: [], anyDrift: false };

    // The same world, with drifted ingredients repriced at their medians.
    const adoptedWorld: CostingWorld = {
      ...world,
      ingredients: Object.fromEntries(
        Object.entries(world.ingredients).map(([id, ing]) => [
          id,
          {
            ...ing,
            standardCostCentsPerThousand:
              drifted.get(id)?.medianCentsPerThousand ??
              ing.standardCostCentsPerThousand,
          },
        ]),
      ),
    };

    const items = [];
    for (const item of Object.values(world.items)) {
      if (item.notSoldDirectly) continue;
      const now_ = costItem(item.id, world);
      const adopted = costItem(item.id, adoptedWorld);
      if (Math.abs(now_.totalCentsPerUnit - adopted.totalCentsPerUnit) < 0.005) {
        continue;
      }
      items.push({
        id: item.id,
        name: item.name,
        now: {
          grossPercent: now_.grossMarginPercent,
          netPercent: now_.netMarginPercent,
        },
        ifAdopted: {
          grossPercent: adopted.grossMarginPercent,
          netPercent: adopted.netMarginPercent,
        },
        targetGrossPercent: item.targetGrossMarginPercent ?? null,
        fallsBelowTarget:
          item.targetGrossMarginPercent != null &&
          now_.grossMarginPercent != null &&
          adopted.grossMarginPercent != null &&
          now_.grossMarginPercent >= item.targetGrossMarginPercent &&
          adopted.grossMarginPercent < item.targetGrossMarginPercent,
        causes: [...drifted.entries()]
          .filter(([id]) => usesIngredient(item.id, id, world))
          .map(([id, drift]) => ({
            ingredientId: id,
            name: world.ingredients[id]?.name ?? "",
            via: pathToIngredient(item.id, id, world).join(" → "),
            standardCentsPerThousand: drift.standardCentsPerThousand,
            medianCentsPerThousand: drift.medianCentsPerThousand,
            percent: drift.percent,
            severity: drift.severity,
          })),
      });
    }
    items.sort((a, b) =>
      a.fallsBelowTarget === b.fallsBelowTarget ? 0 : a.fallsBelowTarget ? -1 : 1,
    );
    return { items, anyDrift: true };
  },
});

/** Does this item use that ingredient, at any depth? */
function usesIngredient(
  itemId: string,
  ingredientId: string,
  world: CostingWorld,
  depth = 0,
): boolean {
  if (depth > 16) return false;
  const item = world.items[itemId];
  if (!item) return false;
  for (const line of item.lines) {
    if (line.componentType === "ingredient" && line.componentId === ingredientId) {
      return true;
    }
    if (
      line.componentType === "menuItem" &&
      usesIngredient(line.componentId, ingredientId, world, depth + 1)
    ) {
      return true;
    }
  }
  return false;
}

/** The sub-recipe names an ingredient travelled through, for "via Buttercream". */
function pathToIngredient(
  itemId: string,
  ingredientId: string,
  world: CostingWorld,
  depth = 0,
): string[] {
  if (depth > 16) return [];
  const item = world.items[itemId];
  if (!item) return [];
  for (const line of item.lines) {
    if (line.componentType === "ingredient" && line.componentId === ingredientId) {
      return [];
    }
  }
  for (const line of item.lines) {
    if (line.componentType !== "menuItem") continue;
    if (usesIngredient(line.componentId, ingredientId, world, depth + 1)) {
      const sub = world.items[line.componentId];
      return [
        sub?.name ?? "",
        ...pathToIngredient(line.componentId, ingredientId, world, depth + 1),
      ].filter(Boolean);
    }
  }
  return [];
}
