import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  orgQuery,
  ownerMutation,
  ownerQuery,
  type MutationCtx,
  type QueryCtx,
} from "./lib/functions";

/**
 * The org as the app sees it. plan, subscriptionStatus, trialEndsAt and
 * foundingMember never leave the server: tiers are invisible to orgs in v1
 * (CONTEXT.md — Access).
 */

const paletteValidator = v.object({
  primary: v.string(),
  accent: v.optional(v.string()),
  tint: v.optional(v.string()),
});

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function assertPalette(palette: {
  primary: string;
  accent?: string;
  tint?: string;
}) {
  for (const value of [palette.primary, palette.accent, palette.tint]) {
    if (value !== undefined && !HEX_RE.test(value)) {
      throw new Error(`"${value}" is not a colour Sous understands.`);
    }
  }
}

function assertPercent(label: string, value: number, min = 0, max = 100) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max} percent.`);
  }
}

function requireProvisioned(org: Doc<"orgs"> | null): Doc<"orgs"> {
  if (!org) throw new Error("This kitchen has not been set up yet.");
  return org;
}

/** "An order exists" — the tax lock's source of truth, computed, never a
 * flag someone forgot to set. */
async function orgHasAnyOrder(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<boolean> {
  const first = await ctx.db
    .query("orders")
    .withIndex("by_org_orderDate", (q) => q.eq("orgId", orgId))
    .first();
  return first !== null;
}

export const getCurrent = orgQuery({
  args: {},
  handler: async (ctx) => {
    return {
      orgId: ctx.orgId,
      role: ctx.role,
      name: ctx.org?.name ?? null,
      slug: ctx.org?.slug ?? null,
      disabled: ctx.org?.disabled ?? false,
      provisioned: ctx.org !== null,
    };
  },
});

/** Theming + the onboarding gate. orgQuery on purpose: her colours and name
 * are not cost data, and staff screens wear the kitchen's palette too. */
export const getTheme = orgQuery({
  args: {},
  handler: async (ctx) => {
    return {
      role: ctx.role,
      provisioned: ctx.org !== null,
      name: ctx.org?.name ?? null,
      palette: ctx.org?.palette ?? null,
      onboardedAt: ctx.org?.onboardedAt ?? null,
      logoUrl: ctx.org?.logo ? await ctx.storage.getUrl(ctx.org.logo) : null,
    };
  },
});

/** The full Business Profile. Owner-only — it carries the money settings. */
export const getProfile = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const org = requireProvisioned(ctx.org);
    return {
      name: org.name,
      slug: org.slug,
      palette: org.palette,
      logoUrl: org.logo ? await ctx.storage.getUrl(org.logo) : null,
      address: org.address ?? null,
      phone: org.phone ?? null,
      email: org.email ?? null,
      replyTo: org.replyTo ?? null,
      socials: org.socials,
      invoicePrefix: org.invoicePrefix,
      invoiceSequence: org.invoiceSequence,
      terms: org.terms ?? null,
      paymentInstructions: org.paymentInstructions ?? null,
      overheadRateCentsPerHour: org.overheadRateCentsPerHour,
      defaultDepositPercent: org.defaultDepositPercent,
      /** Null until she picks one; Home then compares her to her own past. */
      targetNetMarginPercent: org.targetNetMarginPercent ?? null,
      costDriftThresholdPercent: org.costDriftThresholdPercent,
      taxEnabled: org.taxEnabled,
      taxRateBp: org.taxRateBp,
      taxInclusive: org.taxInclusive,
      deliveryFeeModel: org.deliveryFeeModel,
      deliveryFeeConfig: org.deliveryFeeConfig,
      deliveryCostCentsPerKm: org.deliveryCostCentsPerKm,
      zwgDisplayEnabled: org.zwgDisplayEnabled,
      zwgRateMilli: org.zwgRateMilli ?? null,
      stocktakeDay: org.stocktakeDay ?? null,
      /** Null means she has never set one; the calendar reads that as the
       * default rather than as zero hours. */
      productionHoursPerDay: org.productionHoursPerDay ?? null,
      alertsMuted: org.alertsMuted,
      disabled: org.disabled,
      onboarded: org.onboardedAt !== undefined,
      /** Drives the tax confirm dialog — computed, never trusted to a flag. */
      hasAnyOrder: await orgHasAnyOrder(ctx, ctx.orgId),
      /** For the per-ingredient mute list in Settings → Alerts. */
      ingredients: (
        await ctx.db
          .query("ingredients")
          .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
          .collect()
      ).map((i) => ({ id: i._id, name: i.name, alertsMuted: i.alertsMuted })),
    };
  },
});

/** Everything except tax, which has its own lock-aware mutation below.
 * Patches only what's sent. */
export const updateProfile = ownerMutation({
  args: {
    name: v.optional(v.string()),
    palette: v.optional(paletteValidator),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    socials: v.optional(
      v.array(v.object({ label: v.string(), url: v.string() })),
    ),
    invoicePrefix: v.optional(v.string()),
    terms: v.optional(v.string()),
    paymentInstructions: v.optional(v.string()),
    overheadRateCentsPerHour: v.optional(v.number()),
    defaultDepositPercent: v.optional(v.number()),
    costDriftThresholdPercent: v.optional(v.number()),
    deliveryFeeModel: v.optional(
      v.union(v.literal("flat"), v.literal("perKm"), v.literal("freeAbove")),
    ),
    deliveryFeeConfig: v.optional(
      v.object({
        flatCents: v.optional(v.number()),
        perKmCents: v.optional(v.number()),
        freeAboveCents: v.optional(v.number()),
      }),
    ),
    deliveryCostCentsPerKm: v.optional(v.number()),
    zwgDisplayEnabled: v.optional(v.boolean()),
    /** null clears the rate; absent leaves it alone. */
    zwgRateMilli: v.optional(v.union(v.number(), v.null())),
    stocktakeDay: v.optional(v.number()),
    /** null clears it, putting the calendar's capacity flag back on the
     * default rather than on zero. */
    productionHoursPerDay: v.optional(v.union(v.number(), v.null())),
    alertsMuted: v.optional(v.boolean()),
    /** null clears it, which puts Home back on her own history. */
    targetNetMarginPercent: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = requireProvisioned(ctx.org);
    if (args.name !== undefined && args.name.trim() === "") {
      throw new Error("The kitchen needs a name.");
    }
    if (args.palette) assertPalette(args.palette);
    if (args.defaultDepositPercent !== undefined) {
      assertPercent("Deposit", args.defaultDepositPercent);
    }
    if (args.costDriftThresholdPercent !== undefined) {
      assertPercent("Drift threshold", args.costDriftThresholdPercent, 1);
    }
    if (
      args.targetNetMarginPercent !== undefined &&
      args.targetNetMarginPercent !== null
    ) {
      // Not 0-100: a NEGATIVE target is meaningless, and 100% would require
      // ingredients, packaging, gas and her own time to cost nothing.
      assertPercent("Target margin", args.targetNetMarginPercent, 1, 95);
    }
    for (const [label, value] of [
      ["Overhead rate", args.overheadRateCentsPerHour],
      ["Delivery cost", args.deliveryCostCentsPerKm],
    ] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`${label} can't be negative.`);
      }
    }
    if (
      args.stocktakeDay !== undefined &&
      (!Number.isInteger(args.stocktakeDay) ||
        args.stocktakeDay < 0 ||
        args.stocktakeDay > 6)
    ) {
      throw new Error("Stocktake day must be a weekday, 0–6.");
    }
    if (
      args.productionHoursPerDay != null &&
      (!Number.isFinite(args.productionHoursPerDay) ||
        args.productionHoursPerDay <= 0 ||
        args.productionHoursPerDay > 24)
    ) {
      // Zero would flag every single day and 25 is not a day. Refused rather
      // than clamped, so a typo is corrected by her instead of guessed at.
      throw new Error("A baking day has to be between 1 and 24 hours.");
    }
    if (
      args.zwgRateMilli !== undefined &&
      args.zwgRateMilli !== null &&
      (!Number.isFinite(args.zwgRateMilli) || args.zwgRateMilli <= 0)
    ) {
      throw new Error("The ZWG rate must be above zero.");
    }

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined) continue;
      // null means "clear it" for both nullable fields; absent leaves alone.
      patch[key] = value === null ? undefined : value;
    }
    await ctx.db.patch(org._id, patch);
    return null;
  },
});

/** Tax is stamped onto every order at creation; changing it after orders
 * exist requires her explicit confirm — and history never changes either
 * way (CONTEXT.md — Money). */
export const updateTax = ownerMutation({
  args: {
    taxEnabled: v.optional(v.boolean()),
    taxRateBp: v.optional(v.number()),
    taxInclusive: v.optional(v.boolean()),
    /** The client sets this only after she confirms the dialog. */
    confirmStamped: v.optional(v.boolean()),
  },
  handler: async (ctx, { taxEnabled, taxRateBp, taxInclusive, confirmStamped }) => {
    const org = requireProvisioned(ctx.org);
    if (
      taxRateBp !== undefined &&
      (!Number.isFinite(taxRateBp) || taxRateBp < 0 || taxRateBp > 10000)
    ) {
      throw new Error("Tax rate must be between 0% and 100%.");
    }
    const changed =
      (taxEnabled !== undefined && taxEnabled !== org.taxEnabled) ||
      (taxRateBp !== undefined && taxRateBp !== org.taxRateBp) ||
      (taxInclusive !== undefined && taxInclusive !== org.taxInclusive);
    if (!changed) return null;

    const hasAnyOrder = await orgHasAnyOrder(ctx, ctx.orgId);
    if (hasAnyOrder && !confirmStamped) {
      throw new ConvexError({ code: "TAX_LOCKED" as const });
    }
    await ctx.db.patch(org._id, {
      ...(taxEnabled !== undefined && { taxEnabled }),
      ...(taxRateBp !== undefined && { taxRateBp }),
      ...(taxInclusive !== undefined && { taxInclusive }),
      // Informational stamp; the source of truth stays computed.
      taxLocked: hasAnyOrder,
    });
    return null;
  },
});

/** The 4-field welcome screen: name, colours, stocktake day (currency is
 * USD, locked, not a choice). One screen, under a minute, then the app. */
export const completeOnboarding = ownerMutation({
  args: {
    name: v.string(),
    palette: paletteValidator,
    stocktakeDay: v.number(),
  },
  handler: async (ctx, { name, palette, stocktakeDay }) => {
    const org = requireProvisioned(ctx.org);
    if (org.onboardedAt !== undefined) {
      throw new Error("This kitchen is already set up.");
    }
    if (name.trim() === "") throw new Error("The kitchen needs a name.");
    assertPalette(palette);
    if (!Number.isInteger(stocktakeDay) || stocktakeDay < 0 || stocktakeDay > 6) {
      throw new Error("Stocktake day must be a weekday, 0–6.");
    }
    await ctx.db.patch(org._id, {
      name: name.trim(),
      palette,
      stocktakeDay,
      onboardedAt: Date.now(),
    });
    return null;
  },
});

/** Owner-only acceptance probe retained from the auth slice; also reachable
 * through updateProfile. */
export const setCostDriftThreshold = ownerMutation({
  args: { costDriftThresholdPercent: v.number() },
  handler: async (ctx, { costDriftThresholdPercent }) => {
    const org = requireProvisioned(ctx.org);
    assertPercent("Drift threshold", costDriftThresholdPercent, 1);
    await ctx.db.patch(org._id, { costDriftThresholdPercent });
    return null;
  },
});

export const setIngredientAlertMute = ownerMutation({
  args: { ingredientId: v.id("ingredients"), muted: v.boolean() },
  handler: async (ctx, { ingredientId, muted }) => {
    const ingredient = await ctx.db.get(ingredientId);
    // Same NOT_FOUND for "someone else's" and "nonexistent".
    if (!ingredient || ingredient.orgId !== ctx.orgId) {
      throw new ConvexError({ code: "NOT_FOUND" as const });
    }
    await ctx.db.patch(ingredientId, { alertsMuted: muted });
    return null;
  },
});
