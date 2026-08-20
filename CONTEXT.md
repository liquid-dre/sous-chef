# CONTEXT.md — Sous

Sous is a business-management app for independent chefs and small kitchens. Its
single purpose: chefs are excellent at food and poor at margin arithmetic, so Sous
measures expenses against sales and tells them the truth about whether they are
making money.

This file is the domain vocabulary and decision record. Every future session reads
it first. Nothing here is speculative — every line is a settled decision. If a new
decision is made, record it here in the same session.

**Stack (decided):** Next.js 16 (App Router) · Convex (data layer) · Clerk
Organizations (auth) · Tailwind 4 · Resend (email) · Bklit UI (all charts —
see DESIGN.md §5).

---

## Ubiquitous language

Use these words in code, UI, and conversation. No synonyms.

- **Menu item** — a recipe plus a price plus a target margin. There is no separate
  "recipe" entity. A sub-recipe (buttercream, base dough) is a menu item flagged
  `notSoldDirectly`. Menu items nest.
- **Base batch** — the quantity a recipe is written for. Yields N units, where N is
  a separate editable field from the ingredient quantities. Changing N models
  cutting the same tray differently; it does not scale ingredients.
- **Unit weight** — grams per unit. Required. Falls as yield rises. Guards the
  optimiser from recommending the product into uselessness.
- **Standard cost** — the manually-set ingredient price a menu item is costed
  against. Purchases never overwrite it. Stability is the point.
- **Cost drift** — when the median of the last 3 purchase prices diverges from
  standard cost by more than the org threshold (default 10%).
- **Variable cost** — layer 1 (ingredients) + layer 2 (per-unit extras: packaging,
  box, ribbon). Scales with each unit sold.
- **Overhead** — layer 3. An org-level rate per production hour covering the chef's
  own labour, gas and power. Her labour is never free.
- **Gross margin** — against variable cost. **Net margin** — against all three
  layers. Both are always shown; neither substitutes for the other.
- **Order** — the single source of truth for a sale. An invoice is a rendering of
  an order, not a separate entity.
- **Overhang** — units produced beyond what the order required. Becomes stock on
  hand; auto-booked as waste at shelf-life expiry, against that batch's cost.
- **Production log** — the record that a batch was actually made, with actual
  yield. The only event that deducts pantry (ingredient) stock.
- **Pantry** — inventory. Her word. Never "stock control" or "inventory
  management" in UI.
- **Optimiser** — a yield/price suggestion engine per menu item. Given the three
  cost layers and the target gross margin, it computes what combinations of
  (price, yield N) would hit the target — e.g. "to hit 65% you would need $2.74,
  or cut the tray into 14 units — but unit weight would drop to 38g." Price and
  yield are its only two levers. Unit weight guards the yield lever; feedback
  warnings attach when customers already rate the item "too small" or "too
  expensive." It only ever states arithmetic. It is not a demand model, not a
  menu-mix planner, not an ingredient substituter.
- **Sensory axis** — a per-menu-item quality dimension (sweetness, moisture,
  richness, saltiness, heat, portion size, doneness) with a target, rated by
  customers on a 5-point diverging scale where the midpoint is "just right".
- **Org** — a kitchen. Roles: owner (everything) and staff (orders, production,
  feedback — never costs, margins or the dashboard). Exactly two roles.

---

## Locked decisions

### Money

- USD only, everywhere. No multicurrency. An org may optionally display a ZWG
  equivalent line on invoices at a rate it sets; this is a render, not a
  conversion, and never touches stored data.
- Standard cost is manual. Purchases inform it via cost drift; they never write
  it.
- Standard cost is set per ingredient in the ingredient's own unit of measure
  ($/kg or $/L), never per purchase pack size.
- Three cost layers, always. Gross and net margin both surfaced.
- Orders snapshot cost-of-goods **at order creation, per line** — the moment a
  line is added or edited, it captures the item's current three-layer cost.
  Editing a line before delivery re-snapshots that line only. Once the order is
  delivered (or cancelled with production logged), lines are immutable.
  Historical profit is immutable; re-pricing an ingredient never changes last
  month's numbers. Rationale: creation is when she quotes the price, so the
  margin she saw when she accepted the order is the margin history remembers.
- Target gross margin is set per menu item, not per org.
- Tax is off by default. Inclusive/exclusive is freely editable until the first
  order exists, then locked behind a confirm; the choice is stamped onto each
  order.
- Cost drift requires at least 3 purchases on record for that ingredient. Below
  3, no drift signal exists — not a softened warning, nothing. Silence is honest:
  Sous doesn't yet have enough evidence to stand behind a number, and the
  ingredient was costed manually anyway.

### Recipes

- No volume-to-mass conversion. Each ingredient is mass or volume, and stays
  there.
- Nested sub-recipes from day one.
- A parent consumes a sub-recipe **in units of the sub, fractions allowed**, with
  the gram equivalent displayed alongside via the sub's required unit weight
  (e.g. "1.5 units buttercream ≈ 300g"). One rule for all nesting; cost rolls up
  as the sub's per-unit variable cost × units consumed. No second entry mode for
  grams — unit weight already gives the translation.
- Scaling is by whole-batch multiples only.
- Unit weight is manual, with automatic proportional rescaling when N changes:
  editing N recomputes unit weight as old × (oldN ÷ newN), pre-filled and
  editable — changing N means cutting the same tray differently, so total mass is
  constant. This is what makes the optimiser's yield lever honest.
- Each menu item carries a manually-entered **production time per base batch**
  (e.g. "3.5 hours per tray"). Overhead per unit = org rate × batch hours ÷ yield
  N. Nested sub-recipes contribute their own batch time proportionally when
  consumed by a parent. No timers, no tracking actual hours in the production log
  for v1 — the estimate is hers to set and revise.
- Items flagged `notSoldDirectly`: price, target margin, and shelf life are not
  required (hidden). They exist only to be consumed by parents. Cost layers still
  compute.
- Shelf life in days is a per-menu-item field, required for anything sellable
  directly. Finished goods only — no ingredient expiry in v1.

### Orders

- One entity. Invoice renders from it.
- Delivery date defaults to max(order date + 1 day, order date + item lead time),
  editable, set at creation, lands on the calendar.
- Payment is a table, not a state. Status derives from sum(payments) vs total:
  Unpaid, Part-paid, Paid. Deposits are just payments. Org-level default
  deposit %, editable per order, never enforced.
- A payment row is amount + date + optional free-text method (cash, EcoCash,
  transfer). No payment-method entity in v1.
- Revenue recognises on delivery date. Cash received is a separate view.
- Off-menu lines allowed with manual price and rough cost, flagged uncosted. The
  rough cost powers the live margin display on the order screen only — she typed
  a price, she deserves the immediate gut-check, including against discounts. It
  is excluded from all dashboard and analytics aggregates; its revenue counts
  toward the "% of revenue Sous cannot analyse" figure the dashboard reports.
- Cancellation requires a reason. If production was logged, the cost stays on the
  books as waste.
- Discounts allowed, with margin recalculating live as she types.
- Customer identity key is phone number. Email is optional.
- One order = one date, one address.
- An order line can be fulfilled from stock on hand, consuming the oldest batch's
  overhang at its snapshot cost, deducted at delivery. Finished-goods stock has
  exactly two exits: fulfil an order, or expire to waste.

### Invoicing

- Per-org sequential numbering, never reused, org-set prefix.
- One React component renders both screen preview and PDF, server-side, in a
  Next.js route handler. What she screenshots is pixel-identical to what emails
  out.
- After an order is marked sent, any edit increments a revision number printed on
  the document.
- Delivery fee: flat, rate/km with manually typed km, or free above threshold.
- Delivery cost is a single manually-typed field per order (her fuel/rider
  estimate, zero allowed) — no mileage rates or vehicle profiles in v1. The
  delivery fee is an order revenue line; the delivery cost is an order-level cost
  that hits net margin at order and dashboard level only. It never touches
  per-menu-item margins — a cake's costing shouldn't wobble based on which suburb
  one buyer lives in. Charging $5 and burning $4 of fuel must read as $1, not $5.
- Email via Resend from a Sous domain, org's email as reply-to.

### Pantry

- Purchase entry doubles as stock-in, entered per line item. Price is entered as
  the total paid per line ("2kg flour, $3.70") — matching how a receipt reads;
  unit price is derived.
- Deduction happens on production log. Nothing else moves pantry stock.
- A production log deducts **only its direct lines**: raw ingredient lines deduct
  from the pantry; sub-recipe lines deduct from the sub's finished stock on hand
  (which only exists if a sub batch was logged, e.g. as overhang). It never
  recursively deducts the sub's raw ingredients — that would mean stock moved
  without a production log for the sub. If sub stock is insufficient, Sous
  prompts "log a buttercream batch too?" — one tap logs both.
- Alerts look forward at the order book: "3 orders this week need 4 batches; you
  have milk for 1." Never backward at levels alone.
- Ingredients may be flagged don't-track-stock. Still costed, never alerts.
- Weekly stocktake on an org-chosen day, marked on the calendar, reminded the day
  before, escalated when missed.
- Stock estimates carry a freshness age. When purchase logging goes stale, alerts
  soften to "estimates are 11 days old, take a stocktake" rather than firing
  confident wrong reds. Two missed stocktakes in a row puts alerts dormant and
  the dashboard says so. A wrong red alert twice and she mutes the system
  forever.

### Feedback

- Two capture paths. Hers first: one tap on the order list to log what the
  customer said. Then public: `/f/[token]` per order.
- Sensory axes chosen per menu item from a fixed library. Diverging 5-point
  scale. "Too sweet" and "not sweet enough" are opposite fixes and must not
  collapse.
- Universal flags across all items: too expensive, late, packaging, loved it.
- Feedback constrains the optimiser as a warning, never a veto. The chef has
  final say, always. Sous recommends; it does not instruct.

### Comms

- WhatsApp is wa.me deep links only. No Business API, no templates, no Meta
  verification. Sous composes, WhatsApp opens prefilled, she sends from her
  number.
- Every message is drafted for approval. Nothing auto-sends.
- Occasion chips on orders (birthday, anniversary, wedding, funeral, church,
  corporate, just because) are what make reorder reminders possible.
- Per-contact marketing consent flag. On for people who ordered, off for imports,
  one-tap permanent global opt-out.
- Campaign PDFs attach to email; WhatsApp gets a share link for her story.
- No open or click tracking.

### Access

- Clerk Organizations. `orgId` on every document, enforced in one `withOrg`
  wrapper that every Convex query and mutation routes through. Never checked ad
  hoc.
- Cost fields gated server-side in the query. Never hidden with CSS.
- Super user at `/admin` provisions orgs, sets tiers, and may read-only
  impersonate with a persistent banner and a logged session.
- Disabled orgs go read-only. Never deleted.
- Tiers exist in v1 but are invisible to orgs and enforce nothing. Counters run.
  Final shape: Free = 1 user / 30 orders per month, $20 = 3 users / unlimited,
  $50 = unlimited users. Seats and volume, never features — feature-gating
  punishes the small kitchen who needs the margin maths most.
- `foundingMember` boolean grandfathers the pilot to free forever.

### Routes

- `/[orgSlug]/...` for everything org-scoped. Session-scoped routes would
  silently open the wrong kitchen from a bookmark.
- `/admin` for super user. `/f/[token]` feedback. `/i/[token]` shareable invoice.
- Owner nav: Home, Orders, Calendar, Menu, Pantry, Alerts, Customers, Messages,
  Settings. Staff nav: Orders, Calendar, Menu.
- Owner lands on Home. Staff lands on Calendar.
- Mobile-first for orders, calendar, production, alerts. Desktop-comfortable for
  recipe building, purchase entry, analytics. Bottom tab bar on mobile, sidebar
  on desktop, identical routes.

---

## Design principles that are domain, not decoration

- The pilot user is one person. Build for n=1. Every feature is judged on taps.
- Data entry burden is the top cause of death. If logging a sale takes more than
  two taps, sales go unlogged, the dashboard understates revenue, she sees a fake
  loss, and she stops trusting Sous entirely.
- Sous flags, it never instructs. It has no knowledge of demand elasticity and
  must never pretend otherwise. It says "to hit 65% you would need $2.74", never
  "raise your price."
- Never show a number Sous cannot stand behind. Degrade to "estimates are stale"
  rather than assert something false.
