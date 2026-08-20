import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, OrgCtx, QueryCtx } from "./functions";
import type { CostingItem, CostingWorld } from "./costing";

/**
 * Load every menu item and ingredient in the org as a costing world. The
 * pantry is small (n=1 kitchen); loading it whole keeps the engine pure and
 * the recursion trivial.
 *
 * The overhead rate is deliberately NOT a parameter. It used to be, and two
 * of the five call sites passed a literal 0 — harmless there, because those
 * results only fed cycle checks. But orders snapshot their cost layers at
 * creation and the schema forbids ever recomputing them, so one caller
 * passing 0 would freeze layer 3 at zero on every order forever, with net
 * margin quietly equal to gross and nothing anywhere looking broken. A rate
 * that cannot be supplied cannot be supplied wrongly.
 */
export async function loadWorld(
  ctx: (QueryCtx | MutationCtx) & OrgCtx,
): Promise<CostingWorld> {
  const orgId = ctx.orgId;
  const [items, ingredients, allLines] = await Promise.all([
    ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
    ctx.db
      .query("ingredients")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
    ctx.db
      .query("recipeLines")
      .withIndex("by_org_menuItem", (q) => q.eq("orgId", orgId))
      .collect(),
  ]);

  const linesByItem = new Map<string, typeof allLines>();
  for (const line of allLines) {
    const bucket = linesByItem.get(line.menuItemId);
    if (bucket) bucket.push(line);
    else linesByItem.set(line.menuItemId, [line]);
  }

  return {
    items: Object.fromEntries(
      items.map((item) => [
        item._id,
        toCostingItem(item, linesByItem.get(item._id) ?? []),
      ]),
    ),
    ingredients: Object.fromEntries(
      ingredients.map((i) => [
        i._id,
        {
          id: i._id,
          name: i.name,
          baseUnit: i.baseUnit,
          standardCostCentsPerThousand: i.standardCostCentsPerThousand,
        },
      ]),
    ),
    overheadRateCentsPerHour: ctx.org?.overheadRateCentsPerHour ?? 0,
  };
}

export function toCostingItem(
  item: Doc<"menuItems">,
  lines: Doc<"recipeLines">[],
): CostingItem {
  return {
    id: item._id,
    name: item.name,
    notSoldDirectly: item.notSoldDirectly,
    baseBatchYield: item.baseBatchYield,
    unitWeightMilligrams: item.unitWeightMilligrams,
    batchProductionMinutes: item.batchProductionMinutes,
    perUnitExtras: item.perUnitExtras,
    priceCents: item.priceCents ?? null,
    targetGrossMarginPercent: item.targetGrossMarginPercent ?? null,
    lines: lines.map((l) => ({
      componentType: l.componentType,
      componentId: l.componentId as string,
      qtyMilli: l.qtyMilli,
    })),
  };
}
