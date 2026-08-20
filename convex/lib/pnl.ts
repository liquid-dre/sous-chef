import { lineTotalCents, mergeLines } from "../../lib/invoice-totals";
import type { Occasion } from "./contacts";

/**
 * The period P&L — every number Home claims, and the ranking of what is
 * hurting it.
 *
 * Pure, and free of Convex, because this is where a silent lie would live. A
 * margin that is quietly wrong is worse than no dashboard: she would act on
 * it. Everything here is unit-tested against hand-checked arithmetic.
 *
 * Three rules shape the whole file.
 *
 * 1. **PERIOD BASIS, not order basis.** Revenue comes from deliveries dated in
 *    the window; costs come from those orders' stamped snapshots PLUS waste
 *    that expired in the window, whoever it was baked for. It is the only
 *    basis where waste — the expected winner of the leak ranking — sits
 *    *inside* the profit number instead of beside it. The price is that the
 *    per-order ranking does NOT sum to the headline, and the screen says so
 *    rather than letting her discover it.
 * 2. **Uncosted revenue is not in the claim at all.** Off-menu lines carry no
 *    cogsSnapshot, and CONTEXT.md forbids using their rough cost in any
 *    aggregate. Revenue whose cost is unknown cannot produce a margin — so it
 *    is excluded from revenue, costs AND margin, and reported as its own
 *    figure. Including the revenue and not the cost would make her look better
 *    the more off-menu work she did.
 * 3. **The Sankey balances.** Money in equals every branch out plus profit, to
 *    the cent. `sankeyFrom` derives from the same numbers as `rankLeaks`, so a
 *    branch and a sentence cannot disagree about the same leak.
 */

export interface PnlCogs {
  ingredientsCents: number;
  perUnitExtrasCents: number;
  overheadCents: number;
}

export interface PnlLine {
  menuItemId: string | null;
  description: string;
  qtyMilli: number;
  unitPriceCents: number;
  /** Absent on off-menu lines. Its absence IS what "uncosted" means. */
  cogsSnapshot?: PnlCogs | null;
}

export interface PnlOrder {
  id: string;
  /** Domain day. Revenue recognises here (CONTEXT.md — Orders). */
  deliveryDate: string;
  customerId: string | null;
  customerName: string;
  /**
   * The occasion chip, when she tapped one. Optional on the TYPE as well as
   * in the data: every existing caller of this interface predates the field,
   * and a required key would make them all lie about orders whose occasion
   * nobody recorded. Absent means "she did not say", never "just because" —
   * convex/lib/contacts.ts excludes those rather than inventing a category.
   */
  occasion?: Occasion | null;
  discountCents: number;
  deliveryFeeCents: number;
  deliveryCostCents: number;
  taxRateBpAtCreation: number;
  taxInclusiveAtCreation: boolean;
  lines: PnlLine[];
}

/** Waste is dated by the event, not by the order it was once meant for. */
export interface PnlWaste {
  menuItemId: string;
  name: string;
  day: string;
  qtyMilli: number;
  valueCents: number;
}

/** What the period's cooking really cost versus what it was costed at. */
export interface PnlDrift {
  ingredientId: string;
  name: string;
  /** Positive = today's prices are ABOVE the standard cost she set. */
  excessCents: number;
}

export interface PnlInput {
  orders: PnlOrder[];
  waste: PnlWaste[];
  drift: PnlDrift[];
  /** Null when she has not set one; the claim then compares to her own past. */
  targetNetMarginPercent: number | null;
}

export interface PeriodPnl {
  /** What customers paid for work Sous can cost, before anything comes off. */
  grossRevenueCents: number;
  /** Revenue the margin is measured against: gross less VAT and discounts. */
  netRevenueCents: number;
  vatCents: number;
  discountCents: number;
  ingredientsCents: number;
  packagingCents: number;
  overheadCents: number;
  wasteCents: number;
  deliveryCostCents: number;
  deliveryFeeCents: number;
  totalCostCents: number;
  profitCents: number;
  /** Whole percent, or null when there is no revenue to divide by. */
  netMarginPercent: number | null;
  targetNetMarginPercent: number | null;
  /** Stated, never silently folded in (rule 2). */
  uncostedRevenueCents: number;
  uncostedSharePercent: number;
  orderCount: number;
}

const ZERO_COGS: PnlCogs = {
  ingredientsCents: 0,
  perUnitExtrasCents: 0,
  overheadCents: 0,
};

/** Cost of one line, from its stamped snapshot. Zero for off-menu. */
function lineCogs(line: PnlLine): PnlCogs {
  const s = line.cogsSnapshot;
  if (!s) return ZERO_COGS;
  const units = line.qtyMilli / 1000;
  return {
    ingredientsCents: Math.round(s.ingredientsCents * units),
    perUnitExtrasCents: Math.round(s.perUnitExtrasCents * units),
    overheadCents: Math.round(s.overheadCents * units),
  };
}

const isCosted = (line: PnlLine) => Boolean(line.cogsSnapshot);

/**
 * What one order contributes, split into the part Sous can cost and the part
 * it cannot.
 *
 * The discount is APPORTIONED by revenue share rather than dumped on the
 * costed side. A $10 discount on an order that is half off-menu is $5 off each
 * half; charging all $10 against the costed half would understate her margin
 * on work that was priced correctly.
 */
export function orderSplit(order: PnlOrder) {
  // Merged first, exactly as the invoice prints it, so the dashboard's idea of
  // an order's worth is the same arithmetic the customer was billed.
  const merged = mergeLines(order.lines);
  const goodsCents = merged.reduce(
    (sum, m) =>
      sum + lineTotalCents({ description: "", qtyMilli: m.qtyMilli, unitPriceCents: m.unitPriceCents }),
    0,
  );
  const costedGoodsCents = order.lines
    .filter(isCosted)
    .reduce((sum, l) => sum + lineTotalCents(l), 0);
  const uncostedGoodsCents = Math.max(0, goodsCents - costedGoodsCents);

  const discountCents = Math.min(order.discountCents, goodsCents);
  const costedShare = goodsCents > 0 ? costedGoodsCents / goodsCents : 1;
  const costedDiscountCents = Math.round(discountCents * costedShare);

  const cogs = order.lines.reduce(
    (acc, l) => {
      const c = lineCogs(l);
      return {
        ingredientsCents: acc.ingredientsCents + c.ingredientsCents,
        perUnitExtrasCents: acc.perUnitExtrasCents + c.perUnitExtrasCents,
        overheadCents: acc.overheadCents + c.overheadCents,
      };
    },
    { ...ZERO_COGS },
  );

  // Inclusive VAT is money that was never hers. Computed on the costed goods
  // after discount, matching computeInvoiceTotals' inclusive formula.
  const rateBp = order.taxRateBpAtCreation;
  const taxable = costedGoodsCents - costedDiscountCents;
  const vatCents =
    rateBp > 0 && order.taxInclusiveAtCreation
      ? Math.round((taxable * rateBp) / (10000 + rateBp))
      : 0;

  return {
    goodsCents,
    costedGoodsCents,
    uncostedGoodsCents,
    costedDiscountCents,
    vatCents,
    ...cogs,
    deliveryFeeCents: order.deliveryFeeCents,
    deliveryCostCents: order.deliveryCostCents,
  };
}

export function periodPnl(input: PnlInput): PeriodPnl {
  const splits = input.orders.map(orderSplit);

  const sum = (pick: (s: ReturnType<typeof orderSplit>) => number) =>
    splits.reduce((acc, s) => acc + pick(s), 0);

  const costedGoodsCents = sum((s) => s.costedGoodsCents);
  const uncostedRevenueCents = sum((s) => s.uncostedGoodsCents);
  const deliveryFeeCents = sum((s) => s.deliveryFeeCents);
  const discountCents = sum((s) => s.costedDiscountCents);
  const vatCents = sum((s) => s.vatCents);
  const ingredientsCents = sum((s) => s.ingredientsCents);
  const packagingCents = sum((s) => s.perUnitExtrasCents);
  const overheadCents = sum((s) => s.overheadCents);
  const deliveryCostCents = sum((s) => s.deliveryCostCents);
  const wasteCents = input.waste.reduce((acc, w) => acc + w.valueCents, 0);

  // What customers actually handed over, for work Sous can cost.
  const grossRevenueCents = costedGoodsCents + deliveryFeeCents;
  // What the margin is measured against: VAT was never hers, and a discount
  // is revenue she chose not to take.
  const netRevenueCents = grossRevenueCents - vatCents - discountCents;

  const totalCostCents =
    ingredientsCents +
    packagingCents +
    overheadCents +
    wasteCents +
    deliveryCostCents;

  // The identity the Sankey draws, and the one pnl.test.ts asserts to the
  // cent: everything that came in, less every branch that went out.
  const profitCents =
    grossRevenueCents - vatCents - discountCents - totalCostCents;

  const totalRevenueCents = grossRevenueCents + uncostedRevenueCents;

  return {
    grossRevenueCents,
    netRevenueCents,
    vatCents,
    discountCents,
    ingredientsCents,
    packagingCents,
    overheadCents,
    wasteCents,
    deliveryCostCents,
    deliveryFeeCents,
    totalCostCents,
    profitCents,
    netMarginPercent:
      netRevenueCents > 0
        ? // Multiply before dividing: (p−v)/p×100 lands on 56.4999… and
          // rounds DOWN a half-percent that was never lost.
          Math.round((profitCents * 100) / netRevenueCents)
        : null,
    targetNetMarginPercent: input.targetNetMarginPercent,
    uncostedRevenueCents,
    uncostedSharePercent:
      totalRevenueCents > 0
        ? Math.round((uncostedRevenueCents * 100) / totalRevenueCents)
        : 0,
    orderCount: input.orders.length,
  };
}

// --- What is hurting it ----------------------------------------------------

export type LeakKind =
  | "waste"
  | "belowTarget"
  | "drift"
  | "delivery"
  | "discounts";

export interface Leak {
  kind: LeakKind;
  /** The ranking is by this, and only this. */
  cents: number;
  /** Her words. Flags, never instructs (CONTEXT.md). */
  sentence: string;
  /** Where a tap goes. */
  href: string;
  /** Stated when the figure has a known blind spot. */
  caveat?: string;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * One leaking thing, attributed to the subject its money is MEASURED on.
 *
 * This is the atom both groupings are built from, and the reason there is only
 * one computation behind two screens. Home groups these by KIND — "$96 of what
 * you baked was never paid for". The recommendations list groups the same
 * causes by SUBJECT — "Brownies: $96". Neither recomputes anything, so the two
 * screens cannot quote different figures for the same month.
 *
 * Subject is where the money is measured, which is also where the fix acts.
 * Drift stays on the INGREDIENT rather than being spread over the items that
 * use it: the fix is one re-cost of one ingredient, and splitting it across
 * four item cards would show four buttons that all do the same thing once.
 */
export interface LeakCause {
  kind: LeakKind;
  /** "item:<id>" | "ingredient:<id>" | "order:<id>" | "org:discounts" */
  subjectKey: string;
  subjectName: string;
  cents: number;
  /** The arithmetic behind the figure, never a restatement of it. */
  workings: string;
}

/**
 * Every period leak, decomposed to the subject it belongs to.
 *
 * Nothing is invented: a cause with no dollars attached is not emitted at all,
 * rather than emitted as zero. A zero is a number she would try to act on.
 */
export function periodCauses(pnl: PeriodPnl, input: PnlInput): LeakCause[] {
  const causes: LeakCause[] = [];

  const byItem = new Map<string, { name: string; cents: number; qtyMilli: number }>();
  for (const w of input.waste) {
    const row = byItem.get(w.menuItemId) ?? { name: w.name, cents: 0, qtyMilli: 0 };
    row.cents += w.valueCents;
    row.qtyMilli += w.qtyMilli;
    byItem.set(w.menuItemId, row);
  }
  for (const [menuItemId, row] of byItem) {
    if (row.cents <= 0) continue;
    causes.push({
      kind: "waste",
      subjectKey: `item:${menuItemId}`,
      subjectName: row.name,
      cents: row.cents,
      workings: `${units(row.qtyMilli)} baked and never sold, at what they cost to make.`,
    });
  }

  const target = pnl.targetNetMarginPercent;
  if (target != null) {
    // The dollar gap, not the count: two orders 1% under target is not the
    // same problem as one order 30% under, and only dollars can rank them
    // against waste.
    for (const order of input.orders) {
      const s = orderSplit(order);
      const net =
        s.costedGoodsCents + s.deliveryFeeCents - s.vatCents - s.costedDiscountCents;
      if (net <= 0) continue;
      const cost =
        s.ingredientsCents + s.perUnitExtrasCents + s.overheadCents + s.deliveryCostCents;
      const marginPercent = ((net - cost) * 100) / net;
      if (marginPercent >= target) continue;
      const gapCents = Math.round((net * (target - marginPercent)) / 100);
      if (gapCents <= 0) continue;
      causes.push({
        kind: "belowTarget",
        subjectKey: `order:${order.id}`,
        subjectName: orderSubjectName(order),
        cents: gapCents,
        workings: `${money(net)} in, ${money(cost)} out — ${Math.round(marginPercent)}% against your ${target}% target.`,
      });
    }
  }

  for (const d of input.drift) {
    if (d.excessCents <= 0) continue;
    causes.push({
      kind: "drift",
      subjectKey: `ingredient:${d.ingredientId}`,
      subjectName: d.name,
      cents: d.excessCents,
      workings: `What you actually paid for ${d.name} this period, against what your recipes still cost it at.`,
    });
  }

  for (const order of input.orders) {
    const gap = order.deliveryCostCents - order.deliveryFeeCents;
    if (gap <= 0) continue;
    causes.push({
      kind: "delivery",
      subjectKey: `order:${order.id}`,
      subjectName: `${order.customerName} · ${order.deliveryDate}`,
      cents: gap,
      workings: `${money(order.deliveryCostCents)} of fuel against ${money(order.deliveryFeeCents)} charged.`,
    });
  }

  if (pnl.discountCents > 0) {
    causes.push({
      kind: "discounts",
      subjectKey: "org:discounts",
      subjectName: "Discounts",
      cents: pnl.discountCents,
      workings: `Taken off ${pnl.orderCount} ${pnl.orderCount === 1 ? "order" : "orders"} this period.`,
    });
  }

  return causes;
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/**
 * "1 Aug · Tariro Moyo".
 *
 * The date is in the name because two orders from the same customer in one
 * month would otherwise produce two rows with identical labels. It comes
 * FIRST because this string is also a horizontal bar's Y label: at 116px the
 * browser showed three consecutive rows reading "Tariro Moy…", which is worse
 * than no label at all. Date-first, the truncation still tells them apart.
 * The short date for the same reason — "2026-08-01" costs more of the axis
 * than it earns.
 */
function orderSubjectName(order: PnlOrder): string {
  const [, m, d] = order.deliveryDate.split("-");
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)} ${month} · ${order.customerName}` : order.customerName;
}

function units(qtyMilli: number): string {
  const n = qtyMilli / 1000;
  const rounded = Number.isInteger(n) ? n : Math.round(n * 10) / 10;
  return `${rounded} ${rounded === 1 ? "unit" : "units"}`;
}

const LEAK_HREF: Record<LeakKind, (base: string) => string> = {
  waste: (base) => `${base}/production`,
  belowTarget: (base) => `${base}/insights/orders`,
  drift: (base) => `${base}/pantry`,
  delivery: (base) => `${base}/insights/orders`,
  discounts: (base) => `${base}/insights/orders`,
};

/**
 * Every leak, ranked by dollar impact. The Sankey's branch order and the
 * headline sentence both read from here, so they cannot tell different
 * stories about the same month.
 *
 * A grouping of `periodCauses` by kind — NOT a second computation. The
 * recommendations screen groups the identical causes by subject, which is what
 * makes "the one thing hurting it" and the top of that list the same money.
 */
export function rankLeaks(
  pnl: PeriodPnl,
  input: PnlInput,
  base: string,
): Leak[] {
  const causes = periodCauses(pnl, input);
  const byKind = new Map<LeakKind, LeakCause[]>();
  for (const cause of causes) {
    const bucket = byKind.get(cause.kind);
    if (bucket) bucket.push(cause);
    else byKind.set(cause.kind, [cause]);
  }

  const leaks: Leak[] = [];
  for (const [kind, group] of byKind) {
    const cents = group.reduce((a, c) => a + c.cents, 0);
    if (cents <= 0) continue;
    const worst = [...group].sort((a, b) => b.cents - a.cents)[0];
    leaks.push({
      kind,
      cents,
      sentence: leakSentence(kind, cents, group, worst, pnl),
      href: LEAK_HREF[kind](base),
      // Said out loud: an ingredient with fewer than three purchases has no
      // drift signal at all (CONTEXT.md), so this figure is a floor.
      ...(kind === "drift"
        ? { caveat: "Only ingredients you've bought at least three times." }
        : {}),
    });
  }

  return leaks.sort((a, b) => b.cents - a.cents);
}

function leakSentence(
  kind: LeakKind,
  cents: number,
  group: LeakCause[],
  worst: LeakCause,
  pnl: PeriodPnl,
): string {
  switch (kind) {
    case "waste":
      return `${money(cents)} of what you baked was never paid for — mostly ${worst.subjectName}.`;
    case "belowTarget": {
      // Orders, not causes: an order can be below target AND undercharged for
      // delivery, and counting it twice would say she shipped more orders than
      // she did.
      const n = new Set(group.map((c) => c.subjectKey)).size;
      return `${n} ${n === 1 ? "order" : "orders"} shipped below your ${pnl.targetNetMarginPercent}% target — ${money(cents)} short of it.`;
    }
    case "drift":
      return `Ingredients now cost ${money(cents)} more than your recipes say — ${worst.subjectName} most of all.`;
    case "delivery":
      return `Deliveries cost ${money(cents)} more in fuel than you charged for them.`;
    case "discounts":
      return `${money(cents)} came off in discounts.`;
  }
}

// --- The money leak map ----------------------------------------------------

export interface SankeyTree {
  nodes: { name: string; category?: "source" | "landing" | "outcome" }[];
  /** source/target are INDICES into nodes — the vendored chart's shape. */
  links: { source: number; target: number; value: number; semantic?: "loss" | "profit" }[];
}

/**
 * Revenue on the left, every outflow branching off it, profit surviving on the
 * right. Branch width IS the ranking, which is why this chart is evidence for
 * the leak sentence rather than decoration beside it.
 *
 * Zero-value branches are dropped: d3-sankey renders a zero link as a hairline
 * that reads as a real, tiny leak, and "you lost nothing to discounts" is not
 * something to draw.
 */
export function sankeyFrom(pnl: PeriodPnl): SankeyTree {
  const nodes: SankeyTree["nodes"] = [{ name: "Revenue", category: "source" }];
  const links: SankeyTree["links"] = [];

  const branch = (name: string, value: number, semantic?: "loss" | "profit") => {
    if (value <= 0) return;
    nodes.push({ name, category: semantic === "profit" ? "outcome" : "landing" });
    links.push({ source: 0, target: nodes.length - 1, value, semantic });
  };

  branch("Ingredients", pnl.ingredientsCents);
  branch("Packaging", pnl.packagingCents);
  branch("Time & power", pnl.overheadCents);
  branch("Waste", pnl.wasteCents, "loss");
  branch("Delivery", pnl.deliveryCostCents);
  branch("Discounts", pnl.discountCents, "loss");
  branch("VAT", pnl.vatCents);
  // Profit last so it sits at the bottom of the fan: what survives.
  branch("Profit", Math.max(0, pnl.profitCents), "profit");

  return { nodes, links };
}

// --- Drill-downs -----------------------------------------------------------

export interface ItemRow {
  menuItemId: string;
  name: string;
  unitsMilli: number;
  revenueCents: number;
  profitCents: number;
  /** Bound to point size on the scatter, in whole minutes. */
  productionMinutes: number;
  /** Rank by profit minus rank by units. Large and positive = sells a lot,
   * earns little — the reframe this screen exists to deliver. */
  rankGap: number;
}

export function rankItems(
  orders: PnlOrder[],
  minutesPerUnit: Map<string, number>,
): ItemRow[] {
  const byItem = new Map<string, ItemRow>();
  for (const order of orders) {
    const s = orderSplit(order);
    // Apportion the order's discount across its costed lines so an item's
    // profit reflects what was actually collected for it.
    const costed = order.lines.filter(isCosted);
    const costedGoods = s.costedGoodsCents;
    for (const line of costed) {
      if (!line.menuItemId) continue;
      const revenue = lineTotalCents(line);
      const share = costedGoods > 0 ? revenue / costedGoods : 0;
      const discount = Math.round(s.costedDiscountCents * share);
      const vat = Math.round(s.vatCents * share);
      const c = lineCogs(line);
      const row = byItem.get(line.menuItemId) ?? {
        menuItemId: line.menuItemId,
        name: line.description,
        unitsMilli: 0,
        revenueCents: 0,
        profitCents: 0,
        productionMinutes: 0,
        rankGap: 0,
      };
      row.unitsMilli += line.qtyMilli;
      row.revenueCents += revenue - discount - vat;
      row.profitCents +=
        revenue -
        discount -
        vat -
        (c.ingredientsCents + c.perUnitExtrasCents + c.overheadCents);
      row.productionMinutes += Math.round(
        ((minutesPerUnit.get(line.menuItemId) ?? 0) * line.qtyMilli) / 1000,
      );
      byItem.set(line.menuItemId, row);
    }
  }

  const rows = [...byItem.values()];
  const byProfit = [...rows].sort((a, b) => b.profitCents - a.profitCents);
  const byUnits = [...rows].sort((a, b) => b.unitsMilli - a.unitsMilli);
  for (const row of rows) {
    row.rankGap =
      byProfit.findIndex((r) => r.menuItemId === row.menuItemId) -
      byUnits.findIndex((r) => r.menuItemId === row.menuItemId);
  }
  return byProfit;
}

export interface OrderRow {
  orderId: string;
  customerName: string;
  deliveryDate: string;
  revenueCents: number;
  profitCents: number;
  marginPercent: number | null;
  /** Why it is down here, in her words. */
  reason: string | null;
}

/**
 * Worst first. This is where the surprises live: a 52% item plus a discount
 * plus an undercharged delivery quietly ships at a loss, and she will never
 * find it by looking at items alone.
 */
export function rankOrders(orders: PnlOrder[]): OrderRow[] {
  return orders
    .map((order) => {
      const s = orderSplit(order);
      const revenue =
        s.costedGoodsCents + s.deliveryFeeCents - s.vatCents - s.costedDiscountCents;
      const cost =
        s.ingredientsCents +
        s.perUnitExtrasCents +
        s.overheadCents +
        s.deliveryCostCents;
      const profitCents = revenue - cost;
      const reasons: string[] = [];
      if (s.costedDiscountCents > 0) reasons.push(`${money(s.costedDiscountCents)} discount`);
      if (order.deliveryCostCents > order.deliveryFeeCents) {
        reasons.push(
          `${money(order.deliveryCostCents - order.deliveryFeeCents)} more fuel than you charged`,
        );
      }
      return {
        orderId: order.id,
        customerName: order.customerName,
        deliveryDate: order.deliveryDate,
        revenueCents: revenue,
        profitCents,
        marginPercent: revenue > 0 ? Math.round((profitCents * 100) / revenue) : null,
        reason: reasons.length > 0 ? reasons.join(" + ") : null,
      };
    })
    .sort((a, b) => a.profitCents - b.profitCents);
}

export interface CustomerRow {
  customerId: string | null;
  name: string;
  orders: number;
  revenueCents: number;
  profitCents: number;
  marginPercent: number | null;
}

export function rankCustomers(orders: PnlOrder[]): CustomerRow[] {
  const byCustomer = new Map<string, CustomerRow>();
  for (const row of rankOrders(orders)) {
    const order = orders.find((o) => o.id === row.orderId)!;
    // Walk-ins share one bucket rather than each becoming a "customer" —
    // the schema refuses to invent a person and so does this.
    const key = order.customerId ?? "__walkin";
    const entry = byCustomer.get(key) ?? {
      customerId: order.customerId,
      name: order.customerName,
      orders: 0,
      revenueCents: 0,
      profitCents: 0,
      marginPercent: null,
    };
    entry.orders += 1;
    entry.revenueCents += row.revenueCents;
    entry.profitCents += row.profitCents;
    byCustomer.set(key, entry);
  }
  return [...byCustomer.values()]
    .map((c) => ({
      ...c,
      marginPercent:
        c.revenueCents > 0 ? Math.round((c.profitCents * 100) / c.revenueCents) : null,
    }))
    .sort((a, b) => a.profitCents - b.profitCents);
}

// --- Over time -------------------------------------------------------------

export interface DailyRow extends Record<string, number | string> {
  /** Domain day, the shape components/charts-sous/aggregate.ts buckets. */
  date: string;
  revenueCents: number;
  costCents: number;
  profitCents: number;
}

/**
 * Profit per day, for the line and the composed chart.
 *
 * Returned at DAY grain and bucketed on the client by `aggregateByGrain`,
 * which picks the coarsest necessary grain and states it — 400 orders become
 * ~13 weekly points rather than an unreadable smear, and the honest sample
 * size travels with them.
 *
 * Waste is spread across the days it was recognised on, not smeared evenly:
 * it belongs to the day the food stopped being sellable, which is the whole
 * point of the period basis.
 */
export function dailySeries(input: PnlInput): DailyRow[] {
  const byDay = new Map<string, DailyRow>();
  const row = (date: string): DailyRow => {
    let r = byDay.get(date);
    if (!r) {
      r = { date, revenueCents: 0, costCents: 0, profitCents: 0 };
      byDay.set(date, r);
    }
    return r;
  };

  for (const order of input.orders) {
    const s = orderSplit(order);
    const r = row(order.deliveryDate);
    const revenue =
      s.costedGoodsCents + s.deliveryFeeCents - s.vatCents - s.costedDiscountCents;
    const cost =
      s.ingredientsCents +
      s.perUnitExtrasCents +
      s.overheadCents +
      s.deliveryCostCents;
    r.revenueCents += revenue;
    r.costCents += cost;
  }
  for (const waste of input.waste) {
    row(waste.day).costCents += waste.valueCents;
  }
  for (const r of byDay.values()) {
    r.profitCents = r.revenueCents - r.costCents;
  }

  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// --- The cost layers, drilled ----------------------------------------------

export interface CostNode {
  name: string;
  value?: number;
  color?: string;
  children?: CostNode[];
}

/**
 * The cost layers as a hierarchy: five branches in, and the two biggest
 * drilled one level.
 *
 * Ingredients and packaging drill into MENU ITEMS rather than into raw
 * ingredients, and that is a deliberate correction to the brief. A per-raw-
 * ingredient breakdown would have to come from today's recipes multiplied by
 * production, while every figure in the ring above it comes from the cost
 * FROZEN on each order line — so the outer ring would not add up to the inner
 * one the moment a recipe changed. "Which product is eating the ingredient
 * budget" ties exactly, and is the question she can act on anyway.
 */
export function costTree(pnl: PeriodPnl, items: ItemRow[]): CostNode {
  const share = (pick: (i: ItemRow) => number, total: number): CostNode[] => {
    const weightTotal = items.reduce((a, i) => a + Math.max(0, pick(i)), 0);
    if (weightTotal <= 0 || total <= 0) return [];
    return items
      .filter((i) => pick(i) > 0)
      .map((i) => ({
        name: i.name,
        value: Math.round((total * pick(i)) / weightTotal),
      }))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  };

  // Units sold is the right weight for both: ingredients and packaging are
  // per-unit costs, so an item's share of them is its share of the units.
  const byUnits = (i: ItemRow) => i.unitsMilli;

  const children: CostNode[] = [];
  const add = (name: string, value: number, kids?: CostNode[], color?: string) => {
    if (value <= 0) return;
    // A node carries a value OR children, never both. The sunburst layout sums
    // a parent from its children, so setting both counts the branch twice and
    // the ring stops closing the circle — it draws about 270 degrees and looks
    // merely odd rather than wrong, which is the worst way for a chart to be
    // broken.
    children.push(
      kids?.length ? { name, color, children: kids } : { name, value, color },
    );
  };

  add("Ingredients", pnl.ingredientsCents, share(byUnits, pnl.ingredientsCents));
  add("Packaging", pnl.packagingCents, share(byUnits, pnl.packagingCents));
  add("Time & power", pnl.overheadCents);
  add("Waste", pnl.wasteCents, undefined, "var(--chart-loss)");
  add("Delivery", pnl.deliveryCostCents);

  return { name: "Costs", children };
}
