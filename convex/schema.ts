import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The whole schema, written in one pass — tables that exist unused cost
 * nothing; tables added later cost migrations.
 *
 * REPRESENTATION RULES (grilled and locked):
 * - Money is integer cents, fields suffixed `Cents`. Never floats — currency
 *   arithmetic in floating point is how totals end in .00000001 and trust
 *   ends with it. Percentages are whole-number `…Percent`; tax is `…Bp`
 *   (basis points); the ZWG display rate is `…Milli` (×1000).
 * - Every physical quantity is an integer count of THOUSANDTHS of its unit,
 *   suffixed `Milli`: milli-grams / milli-millilitres for ingredients
 *   (baseUnit "g" | "ml"), milli-units for finished goods ("1.5 units of
 *   buttercream" → 1500). One rule, no exceptions, nothing to half-remember.
 * - Domain days ("one order = one date") are "YYYY-MM-DD" strings — they
 *   sort and range-scan correctly and dodge timezone off-by-one-day bugs.
 *   Instants are ms-since-epoch numbers.
 * - Every table carries orgId (the Clerk organization ID string), first field
 *   of every org-scoped index. Tenancy is enforced ONLY in
 *   convex/lib/functions.ts; convex/enforcement.test.ts fails the build on
 *   a table without orgId.
 * - Enum-ish strings are v.union(v.literal(...)) — extending a union later
 *   is free; decoding a stringly-typed field later is not.
 */

// --- Shared enums ---------------------------------------------------------

/** The fixed sensory-axis library (CONTEXT.md — Feedback). */
export const sensoryAxis = v.union(
  v.literal("sweetness"),
  v.literal("moisture"),
  v.literal("richness"),
  v.literal("saltiness"),
  v.literal("heat"),
  v.literal("portionSize"),
  v.literal("doneness"),
);

/** Universal feedback flags across all items (CONTEXT.md — Feedback). */
export const feedbackFlag = v.union(
  v.literal("tooExpensive"),
  v.literal("late"),
  v.literal("packaging"),
  v.literal("lovedIt"),
);

/** Occasion chips — what makes reorder reminders possible. */
export const occasion = v.union(
  v.literal("birthday"),
  v.literal("anniversary"),
  v.literal("wedding"),
  v.literal("funeral"),
  v.literal("church"),
  v.literal("corporate"),
  v.literal("justBecause"),
);

export const channel = v.union(v.literal("whatsapp"), v.literal("email"));

export default defineSchema({
  // ------------------------------------------------------------------ orgs
  /** Sous-specific org state. Identity lives in Clerk; this row is settings,
   * provisioned by the super user at /admin. Disabled orgs go read-only —
   * never deleted. */
  orgs: defineTable({
    /** Clerk organization ID — the same string every other table's orgId holds. */
    orgId: v.string(),
    /** Slug snapshot for display; the routing source of truth is Clerk's. */
    slug: v.string(),
    name: v.string(),

    /** Up to 3 picked colours (DESIGN.md §2); accent/tint derived when absent. */
    palette: v.object({
      primary: v.string(),
      accent: v.optional(v.string()),
      tint: v.optional(v.string()),
    }),
    logo: v.optional(v.id("_storage")),

    /** USD only, everywhere. The field exists so nobody ever "just adds" a
     * second currency without meeting this comment. */
    currency: v.literal("USD"),

    invoicePrefix: v.string(),
    /** Last used number; never reused, even by cancelled orders. */
    invoiceSequence: v.number(),

    taxEnabled: v.boolean(),
    /** Basis points: 15.5% → 1550. */
    taxRateBp: v.number(),
    taxInclusive: v.boolean(),
    /** Set once the first order exists; edits then need a confirm. */
    taxLocked: v.boolean(),

    /** Layer 3: her labour, gas and power. Her labour is never free. */
    overheadRateCentsPerHour: v.number(),
    /** Suggested, editable per order, never enforced. */
    defaultDepositPercent: v.number(),

    /** The number Home's claim sentence is measured against.
     *
     * Deliberately NOT derived from menuItems.targetGrossMarginPercent. Those
     * answer "is this product priced right"; this answers "is the business
     * healthy", and it has to hold still to do that. A revenue-weighted
     * average of item targets moves with her sales mix, so a month heavy on
     * low-target items lowers the bar — she could miss the target by selling
     * differently rather than by doing worse, and hit it the same way. A
     * yardstick that changes length measures nothing.
     *
     * NET, because the claim is about the whole business: her labour, her gas
     * and her power are in it. Unset until she chooses one; the claim then
     * compares against her own past instead. */
    targetNetMarginPercent: v.optional(v.number()),

    deliveryFeeModel: v.union(
      v.literal("flat"),
      v.literal("perKm"),
      v.literal("freeAbove"),
    ),
    /** Which keys apply depends on the model; the others stay unset. */
    deliveryFeeConfig: v.object({
      flatCents: v.optional(v.number()),
      perKmCents: v.optional(v.number()),
      /** Order subtotal at or above this ships free (model "freeAbove"). */
      freeAboveCents: v.optional(v.number()),
    }),
    /** Her own cost side, for the pre-filled estimate — not what she charges. */
    deliveryCostCentsPerKm: v.number(),

    /** Invoice footer & contact block. */
    paymentInstructions: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    /** Resend sends from a Sous domain; replies go here. */
    replyTo: v.optional(v.string()),
    socials: v.array(v.object({ label: v.string(), url: v.string() })),
    terms: v.optional(v.string()),

    /** Weekly stocktake weekday, 0 = Sunday … 6 = Saturday. Unset until chosen. */
    stocktakeDay: v.optional(v.number()),
    /**
     * What a full day of baking is, in hours. The calendar flags a day whose
     * scheduled batches exceed it — FLAGS, never blocks (CONTEXT.md: Sous
     * states arithmetic, it does not instruct).
     *
     * A setting rather than something learned, because there is nothing to
     * learn it from: CONTEXT.md rules out tracking actual hours in v1, so any
     * "observed" figure would just be batchProductionMinutes read back to
     * itself. And the honest answer is genuinely hers — four hours around a
     * day job, twelve in December. Absent means the default (convex/lib/
     * schedule.ts), never zero, which would flag every single day.
     */
    productionHoursPerDay: v.optional(v.number()),
    /** Cost drift fires when |median of last 3| diverges by more than this. */
    costDriftThresholdPercent: v.number(),

    /** A render on invoices, never a conversion. ZWG per USD, ×1000. */
    zwgDisplayEnabled: v.boolean(),
    zwgRateMilli: v.optional(v.number()),

    /** Invisible to orgs; enforces nothing in v1. Counters run regardless. */
    plan: v.union(
      v.literal("free"),
      v.literal("standard"),
      v.literal("unlimited"),
    ),
    subscriptionStatus: v.union(
      v.literal("none"),
      v.literal("trial"),
      v.literal("active"),
      v.literal("lapsed"),
    ),
    trialEndsAt: v.optional(v.number()),
    /** Grandfathers the pilot to free forever. Invisible to orgs. */
    foundingMember: v.boolean(),
    disabled: v.boolean(),
    /** Stamped when the owner completes the 4-field welcome screen; unset
     * means owners get redirected there. Staff are never gated on it. */
    onboardedAt: v.optional(v.number()),
    /** Global alert mute — she pulled the cord. Alerts still compute (the
     * dashboard may state they're muted); they just never fire at her. */
    alertsMuted: v.boolean(),
  })
    .index("by_orgId", ["orgId"]) // withOrg resolution, every request
    .index("by_slug", ["slug"]), // /admin lookup when provisioning

  // ----------------------------------------------------------- ingredients
  ingredients: defineTable({
    orgId: v.string(),
    name: v.string(),
    /** The canonical base unit and the family it is sealed into: "g" mass,
     * "ml" volume, "unit" count (eggs, vanilla pods). NO conversion between
     * families exists anywhere — only exact within-family arithmetic
     * (kg→g, dozen→each). IMMUTABLE once any recipeLine, purchase or
     * stockMovement references this ingredient — mutations enforce it;
     * changing the meaning of stored quantities retroactively is not an
     * edit, it's corruption. */
    baseUnit: v.union(v.literal("g"), v.literal("ml"), v.literal("unit")),
    /** Manual, in cents per 1000 base units — per kg, per litre, or per
     * 1000 count. Displayed in her terms ("$1.85/kg", "$0.30 each").
     * Purchases inform it via drift; they NEVER write it. Stability is the
     * point. */
    standardCostCentsPerThousand: v.number(),
    standardCostSetAt: v.number(),
    /** Don't-track-stock ingredients are still costed, never alerted on. */
    trackStock: v.boolean(),
    /**
     * THERE IS NO STORED LEVEL, deliberately. How much is in the pantry is
     * the sum of stockMovements from the last count forward — see
     * convex/lib/stock.ts. A stored number would be a read-modify-write on
     * every purchase and every batch, and two batches racing on the same
     * flour would silently lose one deduction, forever. Same reasoning that
     * keeps paidCents off `orders` (convex/payments.ts).
     *
     * When this ingredient was last physically COUNTED. Not written by
     * purchases and not by production: a delivery is a movement, a batch is a
     * movement, and neither is somebody standing in the pantry looking at the
     * tub. Only a stocktake anchors, and only for the ingredients she
     * actually counted. Unset means never counted, which is a state Sous says
     * out loud rather than papering over.
     */
    stockAsOf: v.optional(v.number()),
    /** Per-ingredient alert mute (Settings → Alerts). Still costed, still
     * tracked — just never alerted on. */
    alertsMuted: v.boolean(),
  })
    .index("by_org", ["orgId"]) // pantry list
    .index("by_org_name", ["orgId", "name"]), // typeahead in recipes & purchases

  // ------------------------------------------------------------- purchases
  /** Purchase entry doubles as stock-in, one row per receipt line. */
  purchases: defineTable({
    orgId: v.string(),
    ingredientId: v.id("ingredients"),
    /** One shopping trip = one batch id, stamped once per entry session.
     * "Repeat last shop" copies the most recent batch of 3+ lines, so an
     * emergency one-item dash never becomes "her usual basket". */
    purchaseBatchId: v.string(),
    /** The typed pack quantity ×1000 ("2" kg → 2000), kept with packUnit so
     * the line renders back exactly as the receipt read. */
    packQtyMilli: v.number(),
    /** Must belong to the ingredient's family — mutations enforce it. */
    packUnit: v.union(
      v.literal("g"),
      v.literal("kg"),
      v.literal("ml"),
      v.literal("L"),
      v.literal("each"),
      v.literal("dozen"),
    ),
    /** Derived: pack converted to milli-base-units (2 kg → 2,000,000 mg). */
    qtyBaseMilli: v.number(),
    /** Total paid for the line, as the receipt reads. */
    priceCents: v.number(),
    /** Derived at write, rounded to the nearest integer: cents per 1000 base
     * units. Display + drift median only — costing math always recomputes
     * from the exact priceCents/qtyBaseMilli pair. */
    unitPriceCentsPerThousand: v.number(),
    purchasedAt: v.number(),
    /** HER local day (lib/day.ts). Needed because "how long since a shop was
     * logged" softens pantry confidence, and that comparison is against her
     * calendar — the server runs UTC and would answer it a day out either
     * side of midnight. Absent on rows written before this field existed, and
     * absence reads as "we do not know" rather than "never", so an old
     * kitchen is silent instead of wrongly stale (the priceSetAt rule). */
    purchasedOn: v.optional(v.string()),
  })
    .index("by_org_ingredient_time", ["orgId", "ingredientId", "purchasedAt"]) // last-3 drift median
    .index("by_org_batch", ["orgId", "purchaseBatchId"]) // repeat last shop
    .index("by_org_time", ["orgId", "purchasedAt"]), // purchase log + freshness age

  // ------------------------------------------------------------- menuItems
  /** A recipe plus a price plus a target margin. There is no separate
   * "recipe" entity; a sub-recipe is a menu item flagged notSoldDirectly. */
  menuItems: defineTable({
    orgId: v.string(),
    name: v.string(),
    notSoldDirectly: v.boolean(),
    /** Units the base batch is cut into. Editing it rescales unitWeight
     * proportionally (same tray, different cuts) — it never scales
     * ingredients. Whole number. */
    baseBatchYield: v.number(),
    /** Milligrams (grams ×1000). Required. Falls as yield rises. */
    unitWeightMilligrams: v.number(),
    /** Optimiser guard: it never suggests a yield that cuts below this. */
    unitWeightFloorMilligrams: v.optional(v.number()),
    /** Hidden/absent for notSoldDirectly items. */
    priceCents: v.optional(v.number()),
    targetGrossMarginPercent: v.optional(v.number()),
    /** Optimiser bounds. constraintNote is REQUIRED (mutation-enforced)
     * whenever any of these four is set — a limit without a reason rots. */
    minPriceCents: v.optional(v.number()),
    maxPriceCents: v.optional(v.number()),
    minYield: v.optional(v.number()),
    maxYield: v.optional(v.number()),
    constraintNote: v.optional(v.string()),
    /** Feeds the delivery-date default: max(order+1d, order+lead time). */
    leadTimeHours: v.optional(v.number()),
    /** Finished-goods shelf life; overhang expires to waste after this.
     * Required for sellable items (mutation-enforced); ingredients have no
     * expiry in v1. */
    shelfLifeHours: v.optional(v.number()),
    /** Layer 2: packaging, box, ribbon — per unit sold. */
    perUnitExtras: v.array(
      v.object({ label: v.string(), costCents: v.number() }),
    ),
    /** Chosen from the fixed library; target is the scale midpoint. */
    sensoryAxes: v.array(sensoryAxis),
    /** Production time per base batch, whole minutes ("3.5 hours" → 210).
     * Layer 3 per unit = org rate × minutes ÷ 60 ÷ yield. Not in the original
     * field list but mandated by CONTEXT.md (Recipes) — overhead cannot
     * compute without it. Sub-recipes contribute theirs proportionally. */
    batchProductionMinutes: v.number(),
    /** When the cached three-layer costing was last recomputed. */
    costedAt: v.optional(v.number()),
    /** When priceCents last ACTUALLY changed — written only on a real price
     * move, never on any other save. costedAt above is the cautionary tale:
     * it is bumped by every write, which makes it useless for answering "how
     * long has this been priced like that". Absent on every item that existed
     * before this field did, and the recommendation reads absence as "we do
     * not know" rather than as "never" — silent for up to 90 days, never
     * wrong. */
    priceSetAt: v.optional(v.number()),
    /** She set the optimiser aside for this item. Suggestions still compute;
     * they just stop asserting — the ingredients.alertsMuted pattern. Absent
     * means she has never set it aside. */
    optimiserSetAsideAt: v.optional(v.number()),
    /** The margin she chose to ship at instead. In six months this is the
     * only thing that will explain why this item sits at 40% — the same
     * reasoning that makes constraintNote required. */
    optimiserSetAsideMarginPercent: v.optional(v.number()),
  })
    .index("by_org", ["orgId"]) // menu screen
    .index("by_org_notSoldDirectly", ["orgId", "notSoldDirectly"]) // sellable list vs sub-recipes
    .index("by_org_name", ["orgId", "name"]), // typeahead on order entry

  // ----------------------------------------------------------- recipeLines
  recipeLines: defineTable({
    orgId: v.string(),
    menuItemId: v.id("menuItems"),
    componentType: v.union(v.literal("ingredient"), v.literal("menuItem")),
    componentId: v.union(v.id("ingredients"), v.id("menuItems")),
    /** Milli-quantities: mg / milli-ml for ingredients, milli-units for
     * sub-recipes (1.5 units → 1500). */
    qtyMilli: v.number(),
    /** Must match the component: the ingredient's baseUnit, or "unit" for a
     * sub-recipe. Stored (not derived) so a line renders without a join.
     * "unit" is not ambiguous — componentType says whether it means
     * sub-recipe units ("1.5 units of buttercream") or a count ingredient
     * ("3 eggs"). */
    unit: v.union(v.literal("g"), v.literal("ml"), v.literal("unit")),
  })
    .index("by_org_menuItem", ["orgId", "menuItemId"]) // recipe editor, costing
    .index("by_org_component", ["orgId", "componentType", "componentId"]), // where-used; baseUnit immutability check

  // ------------------------------------------------------------- customers
  customers: defineTable({
    orgId: v.string(),
    name: v.string(),
    /** The identity key (CONTEXT.md — Orders). */
    phone: v.string(),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    /** On for people who ordered, off for imports. Opt-out is permanent —
     * the mutation refuses to flip it back on. */
    marketingConsent: v.boolean(),
    consentSource: v.union(
      v.literal("order"),
      v.literal("import"),
      v.literal("manual"),
      v.literal("optedOut"),
    ),
    notes: v.optional(v.string()),
  })
    .index("by_org_phone", ["orgId", "phone"]) // identity lookup on order entry
    .index("by_org_name", ["orgId", "name"]), // customers screen

  // ---------------------------------------------------------------- orders
  /** The single source of truth for a sale. An invoice is a rendering of an
   * order, not a separate entity. */
  orders: defineTable({
    orgId: v.string(),
    /** Absent for a walk-in: a market-stall sale has no customer, and a
     * sentinel "Walk-in" row would carry marketing consent, land in campaign
     * audiences and haunt receivables as a person who does not exist. */
    customerId: v.optional(v.id("customers")),
    /** Domain days: "YYYY-MM-DD". One order = one date, one address. */
    orderDate: v.string(),
    deliveryDate: v.string(),
    /** Falls back to the customer's address at render when unset. */
    deliveryAddress: v.optional(v.string()),
    status: v.union(
      v.literal("confirmed"),
      v.literal("delivered"),
      v.literal("cancelled"),
    ),
    /** Required when status = cancelled (mutation-enforced). If production
     * was logged, that cost stays on the books as waste. */
    cancellationReason: v.optional(v.string()),
    occasion: v.optional(occasion),
    deliveryFeeCents: v.number(),
    /** Her fuel/rider estimate, zero allowed. Order-level net-margin cost;
     * never touches per-menu-item margins. */
    deliveryCostCents: v.number(),
    /** Manually typed km, ×1000. Only for the perKm fee model. */
    deliveryKmMilli: v.optional(v.number()),
    /** An amount off the order, not a percent. */
    discountCents: v.number(),
    /** Copied from the org at creation, never read from the org at render —
     * a later tax change must not rewrite an old invoice. */
    taxInclusiveAtCreation: v.boolean(),
    taxRateBpAtCreation: v.number(),
    /** Stamped from orgs.defaultDepositPercent at creation, for the same
     * reason the tax fields are: suggested and editable, but FROZEN, so
     * reprinting March's invoice cannot show a deposit that moved when she
     * changed the org default in June. */
    depositPercent: v.optional(v.number()),
    /** From orgs.invoiceSequence, allocated when the document is first
     * MATERIALISED — never at creation. Sequential per org, never reused;
     * cancelled orders keep theirs. Absent means no document has ever existed
     * for this order, which is the normal state of a market-stall quick sale:
     * numbering it would leave an auditor asking for an invoice that was
     * never written. See convex/invoices.ts — materialise. */
    invoiceNumber: v.optional(v.number()),
    /** Frozen alongside the number. The prefix is half the document's
     * identity, so changing it in Settings must not relabel invoices already
     * sent — the same reason the tax fields are stamped. */
    invoicePrefixAtInvoice: v.optional(v.string()),
    /** Frozen alongside the number, and its PRESENCE is the show-ZWG flag.
     * The rate moves weekly here; a reprint that disagrees with the paper the
     * customer is holding is a dispute Sous caused. */
    zwgRateMilliAtInvoice: v.optional(v.number()),
    /** Set when the invoice is first SHARED OR SENT — not when she downloads
     * a PDF to check it. Edits after this increment revision, printed on the
     * document, and a revision may only appear on something a customer could
     * already hold a different version of. */
    sentAt: v.optional(v.number()),
    /** When a HUMAN first opened the current link.
     *
     * Written from the browser AFTER hydration, never from the page request.
     * WhatsApp, Gmail and iMessage all fetch a shared URL to build a preview
     * card, so recording on the request would stamp "viewed" the instant she
     * pressed send — the signal would not be noisy, it would mean the
     * opposite of what it says. Previewers pull HTML and never run React.
     *
     * Cleared when the link is replaced: the new link has been opened by
     * nobody. */
    invoiceViewedAt: v.optional(v.number()),
    revision: v.number(),
    /** quickSale = the two-tap path; still a full order underneath. */
    source: v.union(v.literal("app"), v.literal("quickSale")),
    /** Unguessable tokens for the public routes. The token IS the
     * authorisation, so these two indexes are the only non-org-prefixed
     * lookups in the schema. */
    feedbackToken: v.string(),
    invoiceToken: v.string(),
  })
    .index("by_org_deliveryDate", ["orgId", "deliveryDate"]) // calendar; revenue recognition
    .index("by_org_orderDate", ["orgId", "orderDate"]) // orders list
    .index("by_org_status", ["orgId", "status", "deliveryDate"]) // open orders; forward-looking pantry alerts
    .index("by_org_customer", ["orgId", "customerId", "orderDate"]) // customer history; reorder reminders
    .index("by_org_invoiceNumber", ["orgId", "invoiceNumber"]) // invoice lookup
    .index("by_feedbackToken", ["feedbackToken"]) // /f/[token], unauthenticated
    .index("by_invoiceToken", ["invoiceToken"]), // /i/[token], unauthenticated

  // ------------------------------------------------------------ orderLines
  orderLines: defineTable({
    orgId: v.string(),
    orderId: v.id("orders"),
    /** Absent for off-menu lines. */
    menuItemId: v.optional(v.id("menuItems")),
    /** Off-menu description; menu lines render from the item. */
    description: v.optional(v.string()),
    /** Milli-units of the item (whole sales are the norm; the rule is uniform). */
    qtyMilli: v.number(),
    unitPriceCents: v.number(),
    /** Three-layer cost per unit, captured when the line is created or
     * edited pre-delivery. WRITTEN ONCE PER EDIT AND NEVER RECOMPUTED
     * AFTERWARDS: historical profit is immutable, and re-pricing an
     * ingredient must never change last month's numbers. Do not "fix" this
     * by recomputing at read time. You are the someone the comment is about.
     * Absent only on off-menu (uncosted) lines — mutations require it for
     * menu-item lines. */
    cogsSnapshot: v.optional(
      v.object({
        ingredientsCents: v.number(),
        perUnitExtrasCents: v.number(),
        overheadCents: v.number(),
      }),
    ),
    /** Off-menu gut-check figure; order-screen display only, excluded from
     * every dashboard aggregate. */
    roughCostCents: v.optional(v.number()),
    /** True for off-menu lines; the dashboard reports the % of revenue it
     * cannot analyse. */
    uncosted: v.boolean(),
    /**
     * The batch that made these units.
     *
     * Two writers. At order creation it is set for lines fulfilled from stock
     * ON HAND, consuming that batch's overhang at its snapshot cost. At
     * production-log time it is set for lines the new batch actually covered —
     * which is what lets a customer's rating be traced back to the yield the
     * tray was cut at, since nothing else in the schema remembers a past
     * `baseBatchYield`.
     *
     * Absent means "we do not know which batch", and every reader must treat
     * it that way rather than guessing at the item's current yield.
     */
    fulfilledFromProductionLogId: v.optional(v.id("productionLogs")),
  })
    .index("by_org_order", ["orgId", "orderId"]) // order detail, invoice render
    .index("by_org_menuItem", ["orgId", "menuItemId"]), // per-item sales; optimiser; feedback join

  // -------------------------------------------------------------- payments
  /** Payment is a table, not a state. Status derives from sum vs total. */
  payments: defineTable({
    orgId: v.string(),
    orderId: v.id("orders"),
    amountCents: v.number(),
    paidAt: v.number(),
    /** Free text: cash, EcoCash, transfer. No payment-method entity in v1. */
    method: v.optional(v.string()),
    note: v.optional(v.string()),
    /** Clerk user ID of whoever took the money. Answers "who took this $40?",
     * which is the first question in a two-person kitchen when the cash and
     * the books disagree, and it also scopes who may undo a mis-tap. */
    recordedBy: v.string(),
  })
    .index("by_org_order", ["orgId", "orderId"]) // payment status derivation
    .index("by_org_paidAt", ["orgId", "paidAt"]), // cash-received view

  // -------------------------------------------------------- productionLogs
  /** The record that a batch was actually made. The ONLY event that deducts
   * pantry stock; deducts only its direct lines (sub-recipe lines come from
   * the sub's finished stock, never recursively from raw ingredients). */
  productionLogs: defineTable({
    orgId: v.string(),
    menuItemId: v.id("menuItems"),
    orderIds: v.array(v.id("orders")),
    /** Whole-batch multiples only. */
    batchCount: v.number(),
    /** Milli-units. Expected = batchCount × baseBatchYield at log time. */
    expectedYieldMilli: v.number(),
    actualYieldMilli: v.number(),
    producedAt: v.number(),
    /** Her local day, for period filtering. producedAt is the instant; this
     * is the day she says it happened — the server has no "today"
     * (lib/day.ts), so a 22:30 bake in Harare would otherwise file itself to
     * tomorrow forever. */
    producedOn: v.string(),
    /** Three-layer cost PER UNIT at the moment the batch was made, integer
     * cents — the same shape and the same rule as orderLines.cogsSnapshot:
     * written once, never recomputed. This is the cost a unit carries out of
     * this batch whichever exit it takes. Sold down, it becomes the
     * fulfilling order line's snapshot instead of the live cost; expired, it
     * is what the waste is valued at. Without it, adopting a new butter
     * price in June would rewrite what March's waste cost. */
    cogsSnapshot: v.object({
      ingredientsCents: v.number(),
      perUnitExtrasCents: v.number(),
      overheadCents: v.number(),
    }),
    /** Milli-units produced beyond what the orders required. */
    overhangQtyMilli: v.number(),
    /** What's still on hand from that overhang: decremented by order
     * fulfilment, by parent batches consuming this sub, and by expiry.
     * Exactly two exits exist for finished goods: fulfil or waste. */
    overhangRemainingQtyMilli: v.number(),
    /** producedAt + shelfLifeHours. Expiry is DERIVED, never swept: overhang
     * is live while now < this and waste after, computed at read time. There
     * is no background job, so there is nothing that can silently stop
     * running and leave rotten stock looking sellable. Absent for
     * sub-recipes, which have no shelf life and therefore never expire. */
    overhangExpiresAt: v.optional(v.number()),
    wasteQtyMilli: v.number(),
    wasteReason: v.optional(v.string()),
  })
    .index("by_org_producedAt", ["orgId", "producedAt"]) // production history
    .index("by_org_menuItem", ["orgId", "menuItemId", "producedAt"]) // oldest-batch overhang (fulfil-from-stock)
    .index("by_org_overhangExpiresAt", ["orgId", "overhangExpiresAt"]), // expiry sweep

  // -------------------------------------------------------- stockMovements
  /**
   * Every pantry change, signed, with its cause. Not the ledger UNDER the
   * estimate — the ledger IS the estimate. Nothing anywhere stores a level;
   * convex/lib/stock.ts sums these forward from the last count.
   *
   * Append-only in the strongest sense: nothing in the codebase patches or
   * deletes a row here. A stocktake that disagrees with the arithmetic
   * appends its variance rather than rewriting what came before, because
   * what she thought last Tuesday is evidence too.
   */
  stockMovements: defineTable({
    orgId: v.string(),
    ingredientId: v.id("ingredients"),
    /** Signed milli-base-units. */
    deltaMilli: v.number(),
    reason: v.union(
      v.literal("purchase"),
      v.literal("production"),
      v.literal("stocktake"),
      v.literal("waste"),
      v.literal("adjustment"),
    ),
    /** The purchase/productionLog/stocktake that caused it, when one did. */
    sourceId: v.optional(v.string()),
    /** Her words, for the two movements that have no document behind them:
     * waste and adjustment. "Dropped the tray", "found a bag behind the
     * flour". Six months on, an unexplained −2kg is indistinguishable from a
     * data-entry slip; the reason is what makes it evidence. */
    note: v.optional(v.string()),
    occurredAt: v.number(),
  })
    .index("by_org_ingredient_time", ["orgId", "ingredientId", "occurredAt"]) // ingredient ledger
    .index("by_org_time", ["orgId", "occurredAt"]), // recent activity

  // ------------------------------------------------------------ stocktakes
  /**
   * A count, and the anchor every level is measured from.
   *
   * PARTIAL by design. `lines` holds what she actually walked over and
   * looked at, not the whole pantry — a count is a physical act, and
   * requiring all of it would mean she either does none of it or types
   * numbers she did not verify. Ingredients absent from `lines` keep their
   * older anchor and visibly age.
   */
  stocktakes: defineTable({
    orgId: v.string(),
    takenAt: v.number(),
    /** HER local day. "Stocktake day" is a weekday on her calendar, so
     * whether one was missed is a question about her week, not about UTC. */
    takenOn: v.string(),
    /** Clerk user ID of whoever counted. In a two-person kitchen this is the
     * first question asked when a variance is large. */
    takenBy: v.string(),
    lines: v.array(
      v.object({
        ingredientId: v.id("ingredients"),
        countedQtyMilli: v.number(),
        previousQtyMilli: v.number(),
        /** counted − previous, stored so the variance she saw is the
         * variance history shows. */
        varianceMilli: v.number(),
      }),
    ),
  }).index("by_org_takenAt", ["orgId", "takenAt"]), // stocktake history; missed-stocktake escalation

  // -------------------------------------------------------------- feedback
  feedback: defineTable({
    orgId: v.string(),
    orderId: v.id("orders"),
    /** Absent for order-level entries (universal flags, general comments). */
    menuItemId: v.optional(v.id("menuItems")),
    /** chef = her one-tap log of what the customer said; customer = /f. */
    source: v.union(v.literal("chef"), v.literal("customer")),
    /** Diverging 5-point: −2..+2, 0 = "just right". "Too sweet" and "not
     * sweet enough" are opposite fixes and must not collapse. */
    axisRatings: v.array(
      v.object({ axis: sensoryAxis, value: v.number() }),
    ),
    flags: v.array(feedbackFlag),
    freeText: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_org_order", ["orgId", "orderId"]) // did this order get feedback?
    .index("by_org_menuItem", ["orgId", "menuItemId", "receivedAt"]) // per-item sensory profile; optimiser warnings
    .index("by_org_receivedAt", ["orgId", "receivedAt"]), // feedback stream

  // ---------------------------------------------------------------- alerts
  /**
   * RESOLUTIONS, not alerts.
   *
   * An OPEN alert is never a row here. It is derived at read time from the
   * order book and the pantry ledger, because a stored one goes stale the
   * moment she buys the milk and there is no cron to clear it — she would be
   * looking at a confident red about food already on her shelf, which
   * CONTEXT.md says makes her mute the system forever. Same doctrine as
   * payment status, cost drift, delivery status, overhang expiry and pantry
   * confidence: derived, never stored.
   *
   * A row appears the moment she RESOLVES one, snapshotting what the alert
   * said so the history is what she actually saw rather than a re-derivation
   * of what today's data would have said. That snapshot is also what makes
   * the resolution expire honestly — see shortfallAtResolutionMilli.
   */
  alerts: defineTable({
    orgId: v.string(),
    type: v.union(
      v.literal("costDrift"),
      v.literal("stockShort"),
      v.literal("staleEstimates"),
      v.literal("stocktakeDue"),
      v.literal("stocktakeMissed"),
      v.literal("overhangExpiring"),
    ),
    severity: v.union(v.literal("amber"), v.literal("red")),
    /** The ingredient/menuItem/order the alert is about, when there is one. */
    subjectId: v.optional(v.string()),
    /**
     * Prefixed and discriminated: "ingredient:<id>", "org:staleEstimates".
     * `subjectId` above is a bare polymorphic string with no way to say what
     * it points at, and a subject may be the ORG itself, which has no
     * document to reference. Same shape recommendationDismissals.subjectKey
     * settled on for the same reason.
     */
    subjectKey: v.string(),
    message: v.string(),
    raisedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    /** Clerk user ID. */
    resolvedBy: v.optional(v.string()),
    /**
     * The shortfall she accepted, in milli-base-units. The whole reason this
     * row is more than a flag: "I am buying milk this afternoon" resolves the
     * problem she was SHOWN, so the alert comes back only when the shortfall
     * gets materially worse — not tomorrow, and not never.
     */
    shortfallAtResolutionMilli: v.optional(v.number()),
    muted: v.boolean(),
  })
    .index("by_org_resolvedAt", ["orgId", "resolvedAt"]) // open alerts (resolvedAt = undefined sorts first)
    .index("by_org_raisedAt", ["orgId", "raisedAt"]) // alert history
    .index("by_org_subject", ["orgId", "subjectKey"]), // is this subject resolved?

  // ----------------------------------------------- recommendationDismissals
  /**
   * "Not now" on a recommendation, recorded as a NUMBER rather than a flag.
   *
   * The precedent is menuItems.optimiserSetAsideMarginPercent: a bare boolean
   * leaves nothing to answer "why is this quiet?" six months later, and worse,
   * nothing to decide when it should stop being quiet. Storing the figure she
   * accepted lets the condition itself resurface the card — the money moving
   * materially, or a new cause attaching to the same subject.
   *
   * Separate from `alerts` on purpose. Alerts are operational and urgent
   * ("buy flour today"); these are economic and rankable ("cupcakes lost
   * $41"). One ordering cannot compare the two honestly, so they stay apart.
   */
  // ---------------------------------------------------- optimiserOverrides
  /**
   * She proceeded against a portion warning. The point of the whole slice.
   *
   * Records the YIELD she chose and what the evidence said at that moment, so
   * "since you moved to 15" is a fact rather than a recollection.
   *
   * Keyed by (item, yield), and that is the whole suppression rule: a
   * different yield is a different decision, so the warning applies afresh
   * there. Nothing else un-mutes it — the factual before/after report takes
   * the warning's place, and re-raising a warning she has already considered
   * would be Sous making the same point twice.
   *
   * Distinct from menuItems.optimiserSetAsideAt, which mutes the whole panel.
   * This mutes ONE warning and keeps every number on screen.
   */
  optimiserOverrides: defineTable({
    orgId: v.string(),
    menuItemId: v.id("menuItems"),
    /** Part of the key, not a detail. */
    yieldUnits: v.number(),
    decidedAt: v.number(),
    /** The warning she overrode, frozen: "3 of 9 said too small". Stored
     * rather than recomputed so the before/after compares against what she
     * was actually shown, not against what the evidence says today. */
    saidTooSmallAtDecision: v.number(),
    sampleAtDecision: v.number(),
    /** Gross margin at the moment she chose, for the same reason. Null when
     * the item had no price and no margin could be computed. */
    grossMarginPercentAtDecision: v.optional(v.number()),
    /** Clerk user ID. */
    decidedBy: v.string(),
  }).index("by_org_item", ["orgId", "menuItemId"]),

  recommendationDismissals: defineTable({
    orgId: v.string(),
    /** "item:<id>" | "ingredient:<id>" | "org:delivery" | "org:discounts".
     * A string rather than a union of ids because a subject may be the org
     * itself, which has no document to point at. */
    subjectKey: v.string(),
    dismissedAt: v.number(),
    /** The figure she accepted, in cents. The whole reason this row exists. */
    dismissedAtCents: v.number(),
    /** Cause kinds present at dismissal. A NEW one brings the card back even
     * when the money has not moved — she dismissed the problem she was shown,
     * not every problem this item will ever have. */
    causeKinds: v.array(v.string()),
    /** Clerk user ID. */
    dismissedBy: v.string(),
  }).index("by_org_subject", ["orgId", "subjectKey"]),

  // ------------------------------------------------------ messageTemplates
  messageTemplates: defineTable({
    orgId: v.string(),
    name: v.string(),
    channel,
    /** Body with {tokens} filled at draft time. */
    body: v.string(),
    /** Email only — WhatsApp has no subject line. */
    subject: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  // ------------------------------------------------------ messageSchedules
  /**
   * "Every Sunday, taking orders for Wednesday."
   *
   * The RULE is stored; the draft it produces is NOT. Whether one is due is
   * derived from this row, her today, and what she has already answered —
   * so the recipients resolve at the moment she opens it. A draft written by
   * a job at 6am can contain somebody who opted out at 9am, which is a
   * quieter version of the failure auto-send causes and the reason Sous has
   * no cron at all.
   */
  messageSchedules: defineTable({
    orgId: v.string(),
    templateId: v.id("messageTemplates"),
    /** 0 = Sunday … 6 = Saturday, matching orgs.stocktakeDay. */
    weekday: v.number(),
    /** Only one audience in v1. A union rather than a boolean so adding
     * "people who ordered this month" later is a literal, not a migration. */
    audience: v.union(v.literal("allConsenting")),
    /** Paused rather than deleted, so her wording survives a quiet month. */
    active: v.boolean(),
  }).index("by_org", ["orgId"]),

  // ---------------------------------------------------------------- outbox
  /** Every message is drafted for approval. Nothing auto-sends — "sent"
   * means she sent it (wa.me opened / email approved), never that Sous did. */
  outbox: defineTable({
    orgId: v.string(),
    templateId: v.optional(v.id("messageTemplates")),
    recipientIds: v.array(v.id("customers")),
    channel,
    body: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("sent"),
      v.literal("dismissed"),
    ),
    /** For reorder reminders surfaced on a future day. */
    scheduledFor: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    /**
     * Which reorder reminder this row answers — `"<orderId>:<year>"`, from
     * convex/lib/contacts.ts `reminderKey`.
     *
     * The reminder LIST itself is never stored: it is derived from the order
     * book on every read, so a customer who opts out or comes back on their
     * own disappears with nothing needing to have run. This row is the record
     * of what SHE did about one of them, and the key is what ties the two
     * together. Scoped to a year on purpose — "not this year" means this
     * year, and the same birthday comes round again in twelve months.
     */
    reminderKey: v.optional(v.string()),
    /**
     * Which recurring draft this row answers — `"<scheduleId>:<YYYY-MM-DD>"`,
     * from convex/lib/messages.ts `scheduleKey`.
     *
     * Sits BESIDE `reminderKey` rather than replacing it: they are two
     * sources answering the same "have I already dealt with this" question,
     * and `reminderKey` already has rows and an index behind it. Merging them
     * into one `sourceKey` is a tidy worth doing when there is live data to
     * migrate, not before.
     */
    scheduleKey: v.optional(v.string()),
    /** The batch this row belongs to, when it came from a campaign. */
    campaignId: v.optional(v.id("campaigns")),
    /**
     * When she tapped through to WhatsApp.
     *
     * The browser cannot see whether she then pressed send, so it asks — and
     * this is the row's memory of the question being open. A row that is
     * `approved` with an `openedAt` and no `sentAt` is one she walked away
     * from mid-batch, which is exactly the state the queue has to survive a
     * reload in order to resume.
     */
    openedAt: v.optional(v.number()),
  })
    .index("by_org_status", ["orgId", "status", "scheduledFor"]) // messages queue
    .index("by_org_scheduledFor", ["orgId", "scheduledFor"]) // upcoming reminders on the calendar
    .index("by_org_reminderKey", ["orgId", "reminderKey"]) // has she dealt with this one?
    .index("by_org_scheduleKey", ["orgId", "scheduleKey"]) // …and this week's recurring one?
    .index("by_org_campaign", ["orgId", "campaignId"]), // the queue for one batch

  // ------------------------------------------------------------- campaigns
  /** One batch: the artefact and who it went to. The per-recipient WORK lives
   * in `outbox`, one row each — see the queue note there. */
  campaigns: defineTable({
    orgId: v.string(),
    name: v.string(),
    /** The campaign PDF: attached to email, share-linked for WhatsApp. */
    fileId: v.optional(v.id("_storage")),
    channel,
    recipientIds: v.array(v.id("customers")),
    sentAt: v.optional(v.number()),
    /** The words. Tokens are resolved per recipient onto the outbox rows;
     * this is what she wrote. */
    body: v.string(),
    /** Email only. */
    subject: v.optional(v.string()),
    /**
     * Unguessable, and REPLACEABLE — the same shape orders.invoiceToken
     * takes, for the same reason. A campaign link goes into an Instagram
     * story, which is about as public as a URL gets, so it must be possible
     * to burn one without deleting the campaign.
     */
    token: v.string(),
  })
    .index("by_org_sentAt", ["orgId", "sentAt"]) // campaign history
    .index("by_token", ["token"]), // the public /c/[token] page

  // --------------------------------------------------- impersonation
  /**
   * A super user looking at somebody else's kitchen.
   *
   * THE ROW IS THE PERMISSION. `resolveOrg` in convex/lib/functions.ts
   * refuses any call whose JWT org claims disagree with the route, and this
   * table is the single documented exception. That is deliberate: the
   * guarantee has to live where the mutations run, because a cookie or a
   * request header is invisible to Convex and read-only would then rest on
   * the browser sending an honest argument (CONTEXT.md — Access).
   *
   * It is also the log. "Session start and end logged with the target org" is
   * not a second artefact to keep in step with this one — it is this one read
   * back, which is the only version that cannot drift.
   *
   * Access is read-only and time-boxed. A row alone is never sufficient: the
   * resolver re-checks the super-user allowlist on every call, so removing an
   * id from SOUS_SUPER_USER_IDS closes every session that id holds open.
   */
  impersonationSessions: defineTable({
    /** The kitchen being looked at. */
    orgId: v.string(),
    /**
     * Denormalised from the org deliberately. The resolver matches on the
     * route's slug and runs on the hot path of every single query and
     * mutation in the app; a second read to translate slug → orgId there
     * would tax every request in the codebase to save one string.
     */
    orgSlug: v.string(),
    /** Clerk user id of the super user. Never a member of `orgId`. */
    superUserId: v.string(),
    startedAt: v.number(),
    /**
     * Unset while the session is open.
     *
     * Written by "Stop impersonating". Sessions that lapse against the
     * 30-minute cap instead keep it unset for good — which is the record
     * that nobody closed the door, and is worth being able to see.
     */
    endedAt: v.optional(v.number()),
  })
    // endedAt is in the key so "the open one" is an index hit rather than a
    // scan-and-filter over a log that only ever grows.
    .index("by_super_open", ["superUserId", "endedAt"])
    .index("by_org", ["orgId", "startedAt"]), // the history for one kitchen
});
