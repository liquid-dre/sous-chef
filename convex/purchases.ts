import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { ownerMutation, ownerQuery } from "./lib/functions";
import { createIngredient } from "./ingredients";
import {
  isPackUnitCompatible,
  toBaseMilli,
  unitPriceCentsPerThousand,
  type BaseUnit,
  type PackUnit,
} from "./lib/drift";

/**
 * Purchase entry — the load-bearing data entry of the whole app. She does
 * this weekly, forever; if it is tedious, Sous dies quietly.
 *
 * One shopping trip is one batch: every line shares a purchaseBatchId, which
 * is what makes "Repeat last shop" possible at all.
 */

const packUnitValidator = v.union(
  v.literal("g"),
  v.literal("kg"),
  v.literal("ml"),
  v.literal("L"),
  v.literal("each"),
  v.literal("dozen"),
);

const baseUnitValidator = v.union(
  v.literal("g"),
  v.literal("ml"),
  v.literal("unit"),
);

/** A line either points at an existing ingredient or creates one inline —
 * she must never have to leave this screen to add an ingredient. */
const lineValidator = v.object({
  ingredientId: v.optional(v.id("ingredients")),
  newIngredient: v.optional(
    v.object({ name: v.string(), baseUnit: baseUnitValidator }),
  ),
  packQtyMilli: v.number(),
  packUnit: packUnitValidator,
  priceCents: v.number(),
});

/** Minimum lines for a batch to count as "a shop" worth repeating — an
 * emergency one-item dash must never become her usual basket. */
export const MIN_LINES_FOR_REPEATABLE_SHOP = 3;

export const createBatch = ownerMutation({
  args: {
    lines: v.array(lineValidator),
    /** Defaults to now; lets her enter yesterday's receipt. */
    purchasedAt: v.optional(v.number()),
    /**
     * HER day for the same moment (lib/day.ts). Optional so the mutation's
     * existing callers keep working, but it is what "how long since a shop
     * was logged" is measured in — that question is about her week, and the
     * server runs UTC, which would answer it a day out either side of
     * midnight.
     */
    purchasedOn: v.optional(v.string()),
  },
  handler: async (ctx, { lines, purchasedAt, purchasedOn }) => {
    if (lines.length === 0) throw new Error("Nothing to record.");
    if (purchasedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) {
      throw new Error("Dates need to look like 2026-08-04.");
    }
    const at = purchasedAt ?? Date.now();
    // One id for the whole trip. Convex forbids Math.random/Date.now-based
    // ids being non-deterministic across retries? No — mutations run once;
    // this is a plain unique string.
    const purchaseBatchId = crypto.randomUUID();

    const created: Id<"purchases">[] = [];
    for (const line of lines) {
      if (line.packQtyMilli <= 0) {
        throw new Error("Every line needs a quantity.");
      }
      if (line.priceCents < 0) throw new Error("A price can't be negative.");

      let ingredientId = line.ingredientId;
      let baseUnit: BaseUnit;

      if (ingredientId) {
        const existing = await ctx.db.get(ingredientId);
        if (!existing || existing.orgId !== ctx.orgId) {
          throw new ConvexError({ code: "NOT_FOUND" as const });
        }
        baseUnit = existing.baseUnit as BaseUnit;
      } else if (line.newIngredient) {
        baseUnit = line.newIngredient.baseUnit;
        if (!isPackUnitCompatible(line.packUnit as PackUnit, baseUnit)) {
          throw new Error(
            `A ${line.packUnit} pack doesn't belong to ${line.newIngredient.name}'s units.`,
          );
        }
        // Seed standard cost from THIS line — she's holding a receipt, not a
        // costing sheet, and this is the only price she has right now.
        const qty = toBaseMilli(line.packQtyMilli, line.packUnit as PackUnit);
        ingredientId = await createIngredient(ctx, ctx.orgId, {
          name: line.newIngredient.name,
          baseUnit,
          standardCostCentsPerThousand: unitPriceCentsPerThousand(
            line.priceCents,
            qty,
          ),
        });
      } else {
        throw new Error("Every line needs an ingredient.");
      }

      if (!isPackUnitCompatible(line.packUnit as PackUnit, baseUnit)) {
        throw new Error(
          `A ${line.packUnit} pack can't be recorded against an ingredient measured in ${baseUnit}.`,
        );
      }

      const qtyBaseMilli = toBaseMilli(
        line.packQtyMilli,
        line.packUnit as PackUnit,
      );
      const purchaseId = await ctx.db.insert("purchases", {
        orgId: ctx.orgId,
        ingredientId,
        purchaseBatchId,
        packQtyMilli: line.packQtyMilli,
        packUnit: line.packUnit,
        qtyBaseMilli,
        priceCents: line.priceCents,
        unitPriceCentsPerThousand: unitPriceCentsPerThousand(
          line.priceCents,
          qtyBaseMilli,
        ),
        purchasedAt: at,
        purchasedOn,
      });
      created.push(purchaseId);

      // One action, two effects — but only where a level means something.
      // For don't-track-stock ingredients nothing ever deducts, so a level
      // could only ever rise; that is a number Sous cannot stand behind.
      //
      // The movement is the ONLY write. There is no level to patch: the
      // pantry figure is the sum of these rows from the last count forward
      // (convex/lib/stock.ts), so two shops entered at once are two appends
      // and neither can lose the other. Nor does a purchase anchor
      // freshness — a delivery arriving is not somebody standing in the
      // pantry looking at the tub, and letting it write stockAsOf would make
      // an unverified estimate read as freshly confirmed.
      const ingredient = (await ctx.db.get(ingredientId))!;
      if (ingredient.trackStock) {
        await ctx.db.insert("stockMovements", {
          orgId: ctx.orgId,
          ingredientId,
          deltaMilli: qtyBaseMilli,
          reason: "purchase",
          sourceId: purchaseId,
          occurredAt: at,
        });
      }
    }

    return { purchaseBatchId, lineCount: created.length };
  },
});

/**
 * The basket behind "Repeat last shop": the most recent batch with enough
 * lines to be a real trip. Returns it ready to prefill, prices included —
 * she's confirming against a receipt, not recalling from memory.
 */
export const lastShop = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db
      .query("purchases")
      .withIndex("by_org_time", (q) => q.eq("orgId", ctx.orgId))
      .order("desc")
      .take(200);
    if (recent.length === 0) return null;

    // Walk back through batches, newest first, until one is big enough.
    const order: string[] = [];
    const byBatch = new Map<string, typeof recent>();
    for (const row of recent) {
      const bucket = byBatch.get(row.purchaseBatchId);
      if (bucket) {
        bucket.push(row);
      } else {
        byBatch.set(row.purchaseBatchId, [row]);
        order.push(row.purchaseBatchId);
      }
    }
    const batchId = order.find(
      (id) => (byBatch.get(id)?.length ?? 0) >= MIN_LINES_FOR_REPEATABLE_SHOP,
    );
    if (!batchId) return null;

    const rows = byBatch.get(batchId)!;
    const lines = await Promise.all(
      rows.map(async (row) => {
        const ingredient = await ctx.db.get(row.ingredientId);
        return {
          ingredientId: row.ingredientId,
          name: ingredient?.name ?? "(removed)",
          baseUnit: (ingredient?.baseUnit ?? "g") as BaseUnit,
          packQtyMilli: row.packQtyMilli,
          packUnit: row.packUnit,
          priceCents: row.priceCents,
          missing: ingredient === null,
        };
      }),
    );
    lines.sort((a, b) => a.name.localeCompare(b.name));

    return {
      purchaseBatchId: batchId,
      purchasedAt: rows[0].purchasedAt,
      lineCount: lines.length,
      totalCents: rows.reduce((n, r) => n + r.priceCents, 0),
      lines: lines.filter((l) => !l.missing),
    };
  },
});

/** The purchase log, newest first. */
export const listRecent = ownerQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("purchases")
      .withIndex("by_org_time", (q) => q.eq("orgId", ctx.orgId))
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    return await Promise.all(
      rows.map(async (row) => ({
        id: row._id,
        purchaseBatchId: row.purchaseBatchId,
        ingredientName: (await ctx.db.get(row.ingredientId))?.name ?? "(removed)",
        packQtyMilli: row.packQtyMilli,
        packUnit: row.packUnit,
        priceCents: row.priceCents,
        unitPriceCentsPerThousand: row.unitPriceCentsPerThousand,
        purchasedAt: row.purchasedAt,
      })),
    );
  },
});
