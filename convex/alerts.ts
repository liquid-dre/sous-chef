import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ownerMutation,
  ownerQuery,
  type OrgCtx,
  type QueryCtx,
} from "./lib/functions";
import { loadWorld } from "./lib/world";
import { batchesFor, requiredForAll } from "./lib/requirements";
import { levelOf, pantryConfidence } from "./stock";
import { isLive } from "./production";
import {
  HORIZON_DAYS,
  degrade,
  horizonEnd,
  runwayFor,
  severityOf,
  shouldResurfaceAlert,
  trustFrom,
  typicalWeeklyMilli,
  type PantryTrust,
  type Runway,
  type Severity,
} from "./lib/alerts";
import type { BaseUnit } from "./lib/drift";

/**
 * Alerts, derived.
 *
 * Nothing here inserts an open alert. The list is computed from the confirmed
 * order book and the pantry ledger every time it is read, so buying milk
 * makes the alert disappear with nothing needing to run — no cron, no sweep,
 * nothing that can silently stop working and leave a confident red on screen
 * about food she already has. The `alerts` table holds RESOLUTIONS only.
 *
 * The sentence this file exists to produce is CONTEXT.md's: "3 orders this
 * week need 4 batches; you have milk for 1." Never "milk is low" — that names
 * a shelf. This names the failure and its date.
 *
 * ownerQuery/ownerMutation throughout. Alerts are owner-only (CONTEXT.md —
 * Org roles), and the runway is one step from her cost position.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type AlertType = Doc<"alerts">["type"];

/** Prefixed and discriminated, because a subject may be the org itself. */
function ingredientKey(id: Id<"ingredients">): string {
  return `ingredient:${id}`;
}

// --- Reading the world ----------------------------------------------------

interface Booked {
  /** Batches of each menu item the horizon's confirmed orders require. */
  demands: { itemId: string; batchCount: number }[];
  orderCount: number;
}

/**
 * What the confirmed orders inside the horizon will take.
 *
 * Reads through `by_org_status` — the index added for exactly this and unused
 * until now — bounded on BOTH ends, unlike production.whatNeedsMaking which
 * collects the whole org and filters in memory.
 *
 * Lines already fulfilled from a batch are excluded: that food exists, so
 * charging the pantry for it again would invent demand.
 */
async function bookedDemand(
  ctx: QueryCtx & OrgCtx,
  today: string,
): Promise<Booked> {
  const end = horizonEnd(today);
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_org_status", (q) =>
      q
        .eq("orgId", ctx.orgId)
        .eq("status", "confirmed")
        .gte("deliveryDate", today)
        .lte("deliveryDate", end),
    )
    .collect();
  if (orders.length === 0) return { demands: [], orderCount: 0 };

  const orderIds = new Set<string>(orders.map((o) => o._id));
  const allLines = await ctx.db
    .query("orderLines")
    .withIndex("by_org_order", (q) => q.eq("orgId", ctx.orgId))
    .collect();

  const wantedMilli = new Map<string, number>();
  for (const line of allLines) {
    if (!orderIds.has(line.orderId)) continue;
    if (!line.menuItemId) continue;
    // Already coming off a batch that exists. It needs no ingredients.
    if (line.fulfilledFromProductionLogId) continue;
    wantedMilli.set(
      line.menuItemId,
      (wantedMilli.get(line.menuItemId) ?? 0) + line.qtyMilli,
    );
  }

  const demands: { itemId: string; batchCount: number }[] = [];
  for (const [itemId, milli] of wantedMilli) {
    const item = await ctx.db.get(itemId as Id<"menuItems">);
    if (!item) continue;
    const batchCount = batchesFor(milli, item.baseBatchYield);
    if (batchCount > 0) demands.push({ itemId, batchCount });
  }
  return { demands, orderCount: orders.length };
}

/** Finished sub-recipe units on the shelf right now, milli-units per item.
 * Only LIVE overhang — expired buttercream is not stock she can use, and
 * counting it would hide a shortfall exactly when it matters. */
async function subStockOnHand(
  ctx: QueryCtx & OrgCtx,
  now: number,
): Promise<Map<string, number>> {
  const logs = await ctx.db
    .query("productionLogs")
    .withIndex("by_org_producedAt", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  const out = new Map<string, number>();
  for (const log of logs) {
    if (!isLive(log, now)) continue;
    out.set(
      log.menuItemId,
      (out.get(log.menuItemId) ?? 0) + log.overhangRemainingQtyMilli,
    );
  }
  return out;
}

// --- The derivation -------------------------------------------------------

export interface DerivedAlert {
  subjectKey: string;
  subjectId: string;
  type: AlertType;
  severity: Severity;
  name: string;
  baseUnit: BaseUnit;
  shortfallMilli: number;
  runway: Runway;
  /** Days since the pantry was counted, present ONLY when the figure is
   * hedged — so the supply half can carry its age inline while the demand
   * half stays a plain fact. */
  staleDays: number | null;
}

type RunwayRow = Runway & {
  severity: Severity | null;
  baseUnit: BaseUnit;
  muted: boolean;
};

async function derive(ctx: QueryCtx & OrgCtx, today: string) {
  const now = Date.now();
  const confidence = await pantryConfidence(
    ctx,
    ctx.orgId,
    today,
    ctx.org?.stocktakeDay ?? null,
  );
  const trust: PantryTrust = trustFrom(confidence.state);

  const [booked, shelf, world, ingredients, movements] = await Promise.all([
    bookedDemand(ctx, today),
    subStockOnHand(ctx, now),
    loadWorld(ctx),
    ctx.db
      .query("ingredients")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect(),
    ctx.db
      .query("stockMovements")
      .withIndex("by_org_time", (q) => q.eq("orgId", ctx.orgId))
      .collect(),
  ]);

  // ONE shelf, shared across every order in the window — three orders draw on
  // the same buttercream, and resolving them independently would let each
  // believe it was covered (convex/lib/requirements.ts).
  const required = requiredForAll(booked.demands, world, new Map(shelf));

  const typical = typicalWeeklyMilli(
    movements
      .filter((m) => m.reason === "production")
      .map((m) => ({
        ingredientId: m.ingredientId,
        deltaMilli: m.deltaMilli,
        occurredAt: m.occurredAt,
      })),
    today,
  );

  const open: DerivedAlert[] = [];
  const runways: RunwayRow[] = [];
  const globallyMuted = ctx.org?.alertsMuted === true;

  for (const ingredient of ingredients) {
    // Salt, water, foil: costed, never counted, never alerted on
    // (CONTEXT.md — Pantry).
    if (!ingredient.trackStock) continue;

    const { levelMilli } = await levelOf(ctx, ingredient);
    const weekly = typical.get(ingredient._id) ?? null;
    const runway = runwayFor({
      ingredientId: ingredient._id,
      name: ingredient.name,
      onHandMilli: levelMilli,
      bookedMilli: required.ingredientMilli.get(ingredient._id) ?? 0,
      typicalWeeklyMilli: weekly,
    });

    const muted = globallyMuted || ingredient.alertsMuted;
    const severity = muted ? null : degrade(severityOf(runway, weekly), trust);

    runways.push({
      ...runway,
      severity,
      baseUnit: ingredient.baseUnit as BaseUnit,
      muted,
    });
    if (severity === null) continue;

    open.push({
      subjectKey: ingredientKey(ingredient._id),
      subjectId: ingredient._id,
      type: "stockShort",
      severity,
      name: ingredient.name,
      baseUnit: ingredient.baseUnit as BaseUnit,
      shortfallMilli: runway.shortMilli,
      runway,
      staleDays: trust === "hedged" ? confidence.daysSinceCount : null,
    });
  }

  // Worst first, then soonest to run out.
  open.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1) ||
      (a.runway.daysOfCover ?? 9999) - (b.runway.daysOfCover ?? 9999),
  );
  runways.sort((a, b) => (a.daysOfCover ?? 9999) - (b.daysOfCover ?? 9999));

  return {
    open,
    runways,
    trust,
    confidence,
    orderCount: booked.orderCount,
    demandBatches: booked.demands.reduce((sum, d) => sum + d.batchCount, 0),
    horizonEnd: horizonEnd(today),
  };
}

/** Resolutions still in force, keyed by subject. */
async function activeResolutions(
  ctx: QueryCtx & OrgCtx,
): Promise<Map<string, Doc<"alerts">>> {
  const rows = await ctx.db
    .query("alerts")
    .withIndex("by_org_subject", (q) => q.eq("orgId", ctx.orgId))
    .collect();
  const out = new Map<string, Doc<"alerts">>();
  for (const row of rows) {
    if (row.resolvedAt === undefined) continue;
    const existing = out.get(row.subjectKey);
    if (!existing || row.resolvedAt > (existing.resolvedAt ?? 0)) {
      out.set(row.subjectKey, row);
    }
  }
  return out;
}

/** Split the derived list by her own resolutions. */
function partition(
  open: DerivedAlert[],
  resolutions: Map<string, Doc<"alerts">>,
): { live: DerivedAlert[]; suppressed: DerivedAlert[] } {
  const live: DerivedAlert[] = [];
  const suppressed: DerivedAlert[] = [];
  for (const alert of open) {
    const resolution = resolutions.get(alert.subjectKey);
    const returns =
      !resolution ||
      shouldResurfaceAlert(
        { shortfallAtResolutionMilli: resolution.shortfallAtResolutionMilli ?? 0 },
        alert.shortfallMilli,
      );
    (returns ? live : suppressed).push(alert);
  }
  return { live, suppressed };
}

// --- Queries --------------------------------------------------------------

export const list = ownerQuery({
  args: {
    today: v.string(),
    severity: v.optional(v.union(v.literal("red"), v.literal("amber"))),
    type: v.optional(v.string()),
  },
  handler: async (ctx, { today, severity, type }) => {
    if (!DAY.test(today)) throw new Error("Dates need to look like 2026-08-04.");
    const picture = await derive(ctx, today);
    const { live, suppressed } = partition(
      picture.open,
      await activeResolutions(ctx),
    );

    const history = await ctx.db
      .query("alerts")
      .withIndex("by_org_raisedAt", (q) => q.eq("orgId", ctx.orgId))
      .order("desc")
      .take(50);

    const mutedIngredients = (
      await ctx.db
        .query("ingredients")
        .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
        .collect()
    )
      .filter((i) => i.trackStock && i.alertsMuted)
      .map((i) => ({ id: i._id, name: i.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      open: live.filter(
        (a) => (!severity || a.severity === severity) && (!type || a.type === type),
      ),
      /** Live but suppressed by her own resolution. Returned rather than
       * dropped — the choice rankRecommendations already makes — so the screen
       * can say "you resolved this" instead of silently hiding it. */
      suppressed,
      resolved: history
        .filter((row) => row.resolvedAt !== undefined)
        .map((row) => ({
          id: row._id,
          type: row.type,
          severity: row.severity,
          message: row.message,
          raisedAt: row.raisedAt,
          resolvedAt: row.resolvedAt!,
          subjectKey: row.subjectKey,
        })),
      runways: picture.runways,
      trust: picture.trust,
      confidence: picture.confidence,
      orderCount: picture.orderCount,
      demandBatches: picture.demandBatches,
      horizonEnd: picture.horizonEnd,
      horizonDays: HORIZON_DAYS,
      globallyMuted: ctx.org?.alertsMuted === true,
      mutedIngredients,
      /** Counts for the filter pills, taken BEFORE filtering so the pills do
       * not shrink as she uses them. */
      counts: {
        red: live.filter((a) => a.severity === "red").length,
        amber: live.filter((a) => a.severity === "amber").length,
      },
    };
  },
});

/**
 * The nav badge. DERIVED — until this slice it counted a table nothing had
 * ever written a row to, so it has never once rendered.
 */
export const unresolvedCount = ownerQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    if (!DAY.test(today)) throw new Error("Dates need to look like 2026-08-04.");
    const picture = await derive(ctx, today);
    const { live } = partition(picture.open, await activeResolutions(ctx));
    return {
      count: live.length,
      /** The badge wears the worst news in the pile. */
      hasRed: live.some((alert) => alert.severity === "red"),
    };
  },
});

// --- Mutations ------------------------------------------------------------

/**
 * One alert, cleared. Never a bulk close — she must be able to deal with the
 * milk without touching the six around it (the scope's own words).
 *
 * Writes the snapshot rather than a flag: the message and severity are what
 * she actually SAW, and re-deriving them later would show her what today's
 * data says instead of what she decided about.
 */
export const resolve = ownerMutation({
  args: {
    subjectKey: v.string(),
    type: v.string(),
    severity: v.union(v.literal("red"), v.literal("amber")),
    message: v.string(),
    shortfallMilli: v.number(),
    subjectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = args.message.trim();
    if (message === "") throw new Error("An alert needs its message to resolve.");
    const now = Date.now();
    return await ctx.db.insert("alerts", {
      orgId: ctx.orgId,
      type: args.type as AlertType,
      severity: args.severity,
      subjectId: args.subjectId,
      subjectKey: args.subjectKey,
      message,
      // A derived alert has no birthday of its own — the condition has been
      // true for as long as it has been true. Stamping both at resolution is
      // honest; inventing an earlier raisedAt would not be.
      raisedAt: now,
      resolvedAt: now,
      resolvedBy: ctx.userId,
      shortfallAtResolutionMilli: Math.round(args.shortfallMilli),
      muted: false,
    });
  },
});

/**
 * Undo. Deletes the row, the argument `recommendations.restore` makes
 * verbatim: the record existed only to keep the alert quiet, and she has just
 * reversed that.
 */
export const unresolve = ownerMutation({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, { alertId }) => {
    const row = await ctx.db.get(alertId);
    if (!row || row.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    await ctx.db.delete(alertId);
    return null;
  },
});

/**
 * The global cord. `orgs.alertsMuted` has existed since provisioning and has
 * suppressed exactly nothing — written by Settings, read back to Settings.
 * `derive` above is its first consumer.
 */
export const setGlobalMute = ownerMutation({
  args: { muted: v.boolean() },
  handler: async (ctx, { muted }) => {
    if (!ctx.org) throw new ConvexError({ code: "NOT_FOUND" as const });
    await ctx.db.patch(ctx.org._id, { alertsMuted: muted });
    return null;
  },
});

// --- The digest -----------------------------------------------------------

/**
 * One email a day, never one per event.
 *
 * Returns the payload only. Composing and sending live in Next
 * (`lib/alert-digest.ts`, `app/api/alerts/digest/route.ts`) for the reason
 * `app/api/invoice/email/route.ts:11-17` gives: a Convex action cannot reach
 * back into this deployment's own web tier.
 */
export const digest = ownerQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    if (!DAY.test(today)) throw new Error("Dates need to look like 2026-08-04.");
    const picture = await derive(ctx, today);
    const { live } = partition(picture.open, await activeResolutions(ctx));
    return {
      kitchenName: ctx.org?.name ?? "your kitchen",
      to: ctx.org?.email ?? null,
      today,
      horizonEnd: picture.horizonEnd,
      orderCount: picture.orderCount,
      demandBatches: picture.demandBatches,
      trust: picture.trust,
      daysSinceCount: picture.confidence.daysSinceCount,
      alerts: live.map((a) => ({
        name: a.name,
        severity: a.severity,
        baseUnit: a.baseUnit,
        shortfallMilli: a.shortfallMilli,
        onHandMilli: a.runway.onHandMilli,
        bookedMilli: a.runway.bookedMilli,
        daysOfCover: a.runway.daysOfCover,
      })),
    };
  },
});
