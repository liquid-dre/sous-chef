import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ownerMutation,
  ownerQuery,
  type MutationCtx,
  type QueryCtx,
} from "./lib/functions";
import {
  confidenceOf,
  levelFrom,
  runningLedger,
  stocktakeDueOn,
  type Anchor,
  type ConfidenceState,
} from "./lib/stock";
import type { BaseUnit } from "./lib/drift";

/* The per-ingredient level lives on convex/ingredients.ts:list — one query
 * for one screen, rather than a second list that could drift from the first.
 * This file owns the ledger underneath it and everything that writes to it. */

/**
 * The pantry ledger.
 *
 * THERE IS NO STORED LEVEL ANYWHERE, and nothing in this file patches one.
 * How much flour there is = the last physical count plus every movement
 * since; every write here is an INSERT. Two batches racing on the same
 * ingredient are two appends, so the sum is right under either ordering and
 * there is no update to lose. A stored counter would be a read-modify-write
 * on the busiest path in the app — the exact failure convex/payments.ts
 * refuses a paidCents field to avoid — and convex/enforcement.test.ts fails
 * the build if one reappears.
 *
 * ownerQuery/ownerMutation throughout. The pantry is nav she alone sees, and
 * every figure here is one step from money: what is on the shelf, valued at
 * standard cost, is her cost position. Staff log production, which moves
 * stock as a side effect of work they can already do.
 *
 * Everything derived comes from convex/lib/stock.ts, which is pure and has
 * no clock. Her day always arrives as an argument — Convex runs UTC, so the
 * server has no "today" (lib/day.ts).
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function assertDay(day: string) {
  if (!DAY.test(day)) throw new Error("Dates need to look like 2026-08-04.");
}

// --- Reading the level ----------------------------------------------------

/**
 * Every movement that still counts, for one ingredient.
 *
 * The anchor pays for itself here: with a count on the books this is a
 * bounded range read from the index rather than the ingredient's whole
 * history. A kitchen two years in reads a week of rows.
 */
async function movementsSince(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  ingredientId: Id<"ingredients">,
  anchorAt: number | null,
): Promise<Doc<"stockMovements">[]> {
  return await ctx.db
    .query("stockMovements")
    .withIndex("by_org_ingredient_time", (q) => {
      const scoped = q.eq("orgId", orgId).eq("ingredientId", ingredientId);
      // STRICTLY after: the stocktake stamps its own variance movement at
      // exactly the anchor instant, and including it would book the
      // discrepancy on top of the number she counted.
      return anchorAt === null ? scoped : scoped.gt("occurredAt", anchorAt);
    })
    .collect();
}

/**
 * The anchor for an ingredient: what she last counted, and when.
 *
 * Walks BACK through stocktakes rather than reading the newest one, because
 * counts are partial — the most recent stocktake may not mention this
 * ingredient at all, and the one that does may be three weeks old. That gap
 * is the freshness age the pantry renders.
 */
async function anchorFor(
  ctx: QueryCtx | MutationCtx,
  ingredient: Doc<"ingredients">,
): Promise<(Anchor & { stocktakeId: Id<"stocktakes"> }) | null> {
  // Absent means never counted, so there is nothing to walk back through.
  if (ingredient.stockAsOf === undefined) return null;
  const takes = await ctx.db
    .query("stocktakes")
    .withIndex("by_org_takenAt", (q) => q.eq("orgId", ingredient.orgId))
    .order("desc")
    .take(50);
  for (const take of takes) {
    const line = take.lines.find((l) => l.ingredientId === ingredient._id);
    if (line) {
      return {
        countedQtyMilli: line.countedQtyMilli,
        takenAt: take.takenAt,
        stocktakeId: take._id,
      };
    }
  }
  return null;
}

export async function levelOf(
  ctx: QueryCtx | MutationCtx,
  ingredient: Doc<"ingredients">,
): Promise<{ levelMilli: number; anchor: Anchor | null }> {
  const anchor = await anchorFor(ctx, ingredient);
  const movements = await movementsSince(
    ctx,
    ingredient.orgId,
    ingredient._id,
    anchor?.takenAt ?? null,
  );
  return { levelMilli: levelFrom(anchor, movements), anchor };
}

/**
 * How much Sous is willing to stand behind the whole pantry.
 *
 * Org-wide rather than per ingredient, because the two inputs are org-wide:
 * whether she took the weekly count, and whether receipts are being logged.
 * Per-ingredient age still renders beside each number — that is the part
 * that varies.
 */
export async function pantryConfidence(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  today: string,
  stocktakeDay: number | null,
): Promise<ConfidenceState & { dueToday: boolean }> {
  const lastTake = await ctx.db
    .query("stocktakes")
    .withIndex("by_org_takenAt", (q) => q.eq("orgId", orgId))
    .order("desc")
    .first();
  const lastPurchase = await ctx.db
    .query("purchases")
    .withIndex("by_org_time", (q) => q.eq("orgId", orgId))
    .order("desc")
    .first();
  return {
    ...confidenceOf({
      lastCountedOn: lastTake?.takenOn ?? null,
      // Absent on rows written before the field existed, and absence reads
      // as "we do not know" rather than "never" — an old kitchen stays
      // silent instead of being told it is stale on no evidence.
      lastPurchaseOn: lastPurchase?.purchasedOn ?? null,
      today,
      stocktakeDay,
    }),
    dueToday: stocktakeDueOn(today, stocktakeDay),
  };
}

/**
 * Just the confidence state, for Home.
 *
 * Two `.first()` index reads and nothing else. Deliberately NOT
 * ingredients.list, which computes drift for every ingredient in the pantry:
 * Home is the screen she opens for thirty seconds on 3G, and it must not pay
 * for the pantry's arithmetic to print one sentence.
 */
export const confidence = ownerQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    assertDay(today);
    return await pantryConfidence(
      ctx,
      ctx.orgId,
      today,
      ctx.org?.stocktakeDay ?? null,
    );
  },
});

/**
 * The arithmetic behind one ingredient's number.
 *
 * DESIGN.md §4 makes a derived figure with no breakdown affordance a defect,
 * and this is the largest derived figure in Sous. Back-dated movements the
 * anchor superseded come back marked rather than dropped: she entered that
 * receipt, it is part of the pantry's history, and a ledger that silently
 * omits rows cannot explain itself.
 */
export const ledgerFor = ownerQuery({
  args: { ingredientId: v.id("ingredients"), limit: v.optional(v.number()) },
  handler: async (ctx, { ingredientId, limit }) => {
    const ingredient = await ctx.db.get(ingredientId);
    if (!ingredient || ingredient.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    const anchor = await anchorFor(ctx, ingredient);
    // The whole history for the view, not just the anchored window — the
    // point of opening it is to see what happened.
    const all = await ctx.db
      .query("stockMovements")
      .withIndex("by_org_ingredient_time", (q) =>
        q.eq("orgId", ctx.orgId).eq("ingredientId", ingredientId),
      )
      .order("desc")
      .take(limit ?? 200);

    const rows = runningLedger(anchor, all);
    return {
      name: ingredient.name,
      baseUnit: ingredient.baseUnit as BaseUnit,
      trackStock: ingredient.trackStock,
      levelMilli: ingredient.trackStock ? levelFrom(anchor, all) : null,
      countedAt: anchor?.takenAt ?? null,
      countedQtyMilli: anchor?.countedQtyMilli ?? null,
      /** Newest first, as the screen reads. */
      rows: rows.reverse().map((r) => {
        // The count's own variance row sits AT the anchor instant, so the
        // pure engine correctly excludes it from the sum — but it is the
        // anchor, not something the anchor overrode, and striking it through
        // would be the ledger misreading its own turning point.
        const isAnchor =
          anchor !== null && r.movement.sourceId === anchor.stocktakeId;
        return {
          id: r.movement._id,
          deltaMilli: r.movement.deltaMilli,
          reason: r.movement.reason,
          note: r.movement.note ?? null,
          occurredAt: r.movement.occurredAt,
          runningMilli: r.runningMilli,
          superseded: r.superseded && !isAnchor,
          /** Everything above this row is history; the number restarts here. */
          isAnchor,
        };
      }),
    };
  },
});

// --- Writing --------------------------------------------------------------

async function trackedIngredient(
  ctx: MutationCtx,
  orgId: string,
  ingredientId: Id<"ingredients">,
): Promise<Doc<"ingredients">> {
  const ingredient = await ctx.db.get(ingredientId);
  if (!ingredient || ingredient.orgId !== orgId) {
    throw new ConvexError({ code: "NOT_FOUND" as const });
  }
  if (!ingredient.trackStock) {
    // Salt, water, foil. A movement against something nothing ever deducts
    // from would start a level that can only ever rise (CONTEXT.md — Pantry).
    throw new Error(`${ingredient.name} isn't one you keep a running amount of.`);
  }
  return ingredient;
}

/**
 * A count, and the anchor everything downstream is measured from.
 *
 * PARTIAL, always. `lines` holds what she actually walked over and looked at.
 * The screen shows the expected figure beside an EMPTY field rather than in
 * it, so a row that arrives here is a row she confirmed — an ingredient she
 * scrolled past keeps its older anchor and visibly ages, which is the only
 * thing that makes freshness carry information.
 *
 * Nothing prior is touched. The variance is APPENDED, stamped at the count's
 * own instant so it records the discrepancy without becoming an operand in
 * the next sum. What she believed last Tuesday stays on the books, because a
 * ledger that rewrites itself cannot be used to work out what went wrong.
 */
export const recordStocktake = ownerMutation({
  args: {
    /** HER day. */
    takenOn: v.string(),
    lines: v.array(
      v.object({
        ingredientId: v.id("ingredients"),
        countedQtyMilli: v.number(),
      }),
    ),
  },
  handler: async (ctx, { takenOn, lines }) => {
    assertDay(takenOn);
    if (lines.length === 0) {
      throw new Error("Count at least one thing before saving.");
    }
    const seen = new Set<string>();
    for (const line of lines) {
      if (seen.has(line.ingredientId)) {
        throw new Error("The same ingredient was counted twice.");
      }
      seen.add(line.ingredientId);
      if (!Number.isFinite(line.countedQtyMilli) || line.countedQtyMilli < 0) {
        throw new Error("A counted amount can't be negative.");
      }
    }

    const takenAt = Date.now();
    const resolved: {
      ingredientId: Id<"ingredients">;
      countedQtyMilli: number;
      previousQtyMilli: number;
      varianceMilli: number;
    }[] = [];

    for (const line of lines) {
      const ingredient = await trackedIngredient(ctx, ctx.orgId, line.ingredientId);
      const { levelMilli } = await levelOf(ctx, ingredient);
      const counted = Math.round(line.countedQtyMilli);
      resolved.push({
        ingredientId: ingredient._id,
        countedQtyMilli: counted,
        previousQtyMilli: levelMilli,
        // Stored, not recomputed later: the variance she saw on screen is the
        // variance the history shows, forever, whatever the ledger does next.
        varianceMilli: counted - levelMilli,
      });
    }

    const stocktakeId = await ctx.db.insert("stocktakes", {
      orgId: ctx.orgId,
      takenAt,
      takenOn,
      takenBy: ctx.userId,
      lines: resolved,
    });

    for (const line of resolved) {
      // Every counted line gets a movement, including a variance of zero.
      // "I counted it and it matched" is a fact about the pantry worth
      // keeping, and it keeps the ledger the single place the story is told.
      await ctx.db.insert("stockMovements", {
        orgId: ctx.orgId,
        ingredientId: line.ingredientId,
        deltaMilli: line.varianceMilli,
        reason: "stocktake",
        sourceId: stocktakeId,
        occurredAt: takenAt,
      });
      await ctx.db.patch(line.ingredientId, { stockAsOf: takenAt });
    }

    return {
      stocktakeId,
      counted: resolved.length,
      /** So the screen can say what actually moved without a second round trip. */
      variances: resolved
        .filter((l) => l.varianceMilli !== 0)
        .map((l) => ({
          ingredientId: l.ingredientId,
          varianceMilli: l.varianceMilli,
        })),
    };
  },
});

/**
 * Something went in the bin. Signed negative, and the reason is required.
 *
 * Six months on, an unexplained −2kg is indistinguishable from a typo. The
 * note is what turns it into evidence — the same argument that makes
 * menuItems.constraintNote required.
 */
export const recordWaste = ownerMutation({
  args: {
    ingredientId: v.id("ingredients"),
    /** Positive. The sign is applied here so a caller cannot accidentally
     * add stock through the waste door. */
    qtyMilli: v.number(),
    note: v.string(),
  },
  handler: async (ctx, { ingredientId, qtyMilli, note }) => {
    await trackedIngredient(ctx, ctx.orgId, ingredientId);
    if (!Number.isFinite(qtyMilli) || qtyMilli <= 0) {
      throw new Error("How much was thrown away?");
    }
    const reason = note.trim();
    if (reason === "") throw new Error("What happened to it?");
    return await ctx.db.insert("stockMovements", {
      orgId: ctx.orgId,
      ingredientId,
      deltaMilli: -Math.round(qtyMilli),
      reason: "waste",
      note: reason,
      occurredAt: Date.now(),
    });
  },
});

/**
 * A correction that is not a count and not waste — a bag found behind the
 * flour, a delivery she will never have a receipt for.
 *
 * Signed, because both directions happen. Distinct from a stocktake on
 * purpose: this moves the level without claiming anybody verified the whole
 * amount, so it does NOT anchor and does not refresh the freshness age.
 */
export const recordAdjustment = ownerMutation({
  args: {
    ingredientId: v.id("ingredients"),
    /** Signed. Negative takes stock away. */
    deltaMilli: v.number(),
    note: v.string(),
  },
  handler: async (ctx, { ingredientId, deltaMilli, note }) => {
    await trackedIngredient(ctx, ctx.orgId, ingredientId);
    if (!Number.isFinite(deltaMilli) || deltaMilli === 0) {
      throw new Error("An adjustment of nothing isn't one.");
    }
    const reason = note.trim();
    if (reason === "") throw new Error("What is this correcting?");
    return await ctx.db.insert("stockMovements", {
      orgId: ctx.orgId,
      ingredientId,
      deltaMilli: Math.round(deltaMilli),
      reason: "adjustment",
      note: reason,
      occurredAt: Date.now(),
    });
  },
});

/** Stocktake history — what she counted, when, and what it disagreed with. */
export const takes = ownerQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("stocktakes")
      .withIndex("by_org_takenAt", (q) => q.eq("orgId", ctx.orgId))
      .order("desc")
      .take(limit ?? 20);
    const names = new Map<string, string>();
    const out = [];
    for (const row of rows) {
      const lines = [];
      for (const line of row.lines) {
        if (!names.has(line.ingredientId)) {
          const ing = await ctx.db.get(line.ingredientId);
          names.set(line.ingredientId, ing?.name ?? "(removed)");
        }
        lines.push({ ...line, name: names.get(line.ingredientId)! });
      }
      out.push({
        id: row._id,
        takenAt: row.takenAt,
        takenOn: row.takenOn,
        lines,
        /** The count that mattered: how many disagreed with the arithmetic. */
        variedCount: lines.filter((l) => l.varianceMilli !== 0).length,
      });
    }
    return out;
  },
});
