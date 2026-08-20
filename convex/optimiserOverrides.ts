import { ConvexError, v } from "convex/values";
import { ownerMutation } from "./lib/functions";
import { costItem } from "./lib/costing";
import { loadWorld } from "./lib/world";
import { batchFacts, portionRatings } from "./lib/portionAdapters";
import { evidenceFor } from "./lib/portionEvidence";

/**
 * She proceeded against a portion warning.
 *
 * CONTEXT.md is unambiguous: feedback constrains the optimiser as a warning,
 * never a veto, and the chef has final say. This is where that stops being a
 * principle and becomes a button.
 *
 * Two things make it more than a mute flag.
 *
 * The evidence is STAMPED, not remembered. `record` recomputes what she was
 * shown from the same pure engine the panel read, so "1 of 9 before" is the
 * figure that was actually on screen when she decided — not what the numbers
 * happen to say when the report is next opened.
 *
 * It is keyed by (item, YIELD). Moving the tray to a different cut is a
 * different decision and the warning applies afresh there. Nothing else ever
 * un-mutes it: the factual before/after report takes the warning's place, and
 * re-raising something she has already weighed would be Sous making the same
 * point twice.
 */

export const record = ownerMutation({
  args: {
    menuItemId: v.id("menuItems"),
    /** The yield she is deciding about — her current cut, not the suggestion.
     * Passed explicitly rather than read off the item so the row can never be
     * keyed to a yield she did not have on screen. */
    yieldUnits: v.number(),
  },
  handler: async (ctx, { menuItemId, yieldUnits }) => {
    const item = await ctx.db.get(menuItemId);
    if (!item || item.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    if (!Number.isInteger(yieldUnits) || yieldUnits < 1) {
      throw new Error("A yield has to be a whole number of units.");
    }

    // Deciding twice about the same size is one decision. Re-recording would
    // reset the "before" figures to today's, and the report would then compare
    // the present against itself.
    const existing = await ctx.db
      .query("optimiserOverrides")
      .withIndex("by_org_item", (q) =>
        q.eq("orgId", ctx.orgId).eq("menuItemId", menuItemId),
      )
      .collect();
    const already = existing.find((o) => o.yieldUnits === yieldUnits);
    if (already) return { overrideId: already._id };

    const [feedbackRows, logs] = await Promise.all([
      ctx.db
        .query("feedback")
        .withIndex("by_org_menuItem", (q) =>
          q.eq("orgId", ctx.orgId).eq("menuItemId", menuItemId),
        )
        .collect(),
      ctx.db
        .query("productionLogs")
        .withIndex("by_org_menuItem", (q) =>
          q.eq("orgId", ctx.orgId).eq("menuItemId", menuItemId),
        )
        .collect(),
    ]);

    // The same engine, the same adapters, the same figures the panel showed.
    const evidence = evidenceFor(portionRatings(feedbackRows), batchFacts(logs));
    const here = evidence.byYield.find((r) => r.yieldUnits === yieldUnits);

    const world = await loadWorld(ctx);
    const costing = costItem(menuItemId, world);

    const overrideId = await ctx.db.insert("optimiserOverrides", {
      orgId: ctx.orgId,
      menuItemId,
      yieldUnits,
      decidedAt: Date.now(),
      saidTooSmallAtDecision: here?.saidTooSmall ?? 0,
      sampleAtDecision: here?.n ?? 0,
      grossMarginPercentAtDecision: costing.grossMarginPercent ?? undefined,
      decidedBy: ctx.userId,
    });
    return { overrideId };
  },
});

/**
 * She changed her mind. The warning comes back and the report goes away.
 *
 * Deleting is right: the row existed only to keep one warning quiet and to
 * hold the figures for the comparison, and she has just withdrawn the decision
 * both of those served.
 */
export const undo = ownerMutation({
  args: { menuItemId: v.id("menuItems"), yieldUnits: v.number() },
  handler: async (ctx, { menuItemId, yieldUnits }) => {
    const rows = await ctx.db
      .query("optimiserOverrides")
      .withIndex("by_org_item", (q) =>
        q.eq("orgId", ctx.orgId).eq("menuItemId", menuItemId),
      )
      .collect();
    const row = rows.find((o) => o.yieldUnits === yieldUnits);
    if (!row) throw new ConvexError({ code: "NOT_FOUND" as const });
    await ctx.db.delete(row._id);
    return null;
  },
});
