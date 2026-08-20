/**
 * The order/invoice arithmetic, in one place, so the order screen, the save
 * mutation and the invoice can never disagree about what an order is worth.
 *
 * It lives in root `lib/` rather than `convex/lib/` on purpose:
 * convex/enforcement.test.ts asserts that nothing under components/invoice/
 * imports from convex, so the invoice preview cannot re-export from there.
 * Root lib/ is the neutral ground both sides already reach into.
 *
 * All arithmetic in integer cents. Quantities arrive as qtyMilli (thousandths
 * of a unit) per the schema's uniform rule.
 */

export interface InvoiceLine {
  description: string;
  qtyMilli: number;
  unitPriceCents: number;
}

export interface InvoiceTax {
  enabled: boolean;
  rateBp: number;
  inclusive: boolean;
}

/** Exactly what computeInvoiceTotals reads. InvoicePreviewData extends it. */
export interface InvoiceTotalsInput {
  lines: InvoiceLine[];
  deliveryFeeCents: number;
  discountCents: number;
  tax: InvoiceTax;
  depositPercent?: number | null;
}

export interface InvoiceTotals {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  /** Added on top (exclusive) — 0 when inclusive or disabled. */
  taxAddedCents: number;
  /** Contained within the total (inclusive) — 0 when exclusive or disabled. */
  taxIncludedCents: number;
  totalCents: number;
  depositCents: number;
}

export function lineTotalCents(line: InvoiceLine): number {
  return Math.round((line.qtyMilli * line.unitPriceCents) / 1000);
}

/** Two stored rows are one line on the customer's page when this matches. */
export function lineGroupKey(row: {
  menuItemId?: string | null;
  description?: string | null;
  unitPriceCents: number;
}): string {
  return `${row.menuItemId ?? row.description ?? ""}|${row.unitPriceCents}`;
}

/**
 * Merge the stored rows into the lines an invoice prints.
 *
 * A line served partly off the shelf and partly fresh is stored as two rows,
 * because each carries its own stamped cost — the customer sees one. Every
 * path that totals an order MUST merge first and total second, because
 * `lineTotalCents` rounds and `round(a) + round(b) ≠ round(a + b)`: 3 units
 * and 2 units at $12.50 sum to $62.50 merged and $62.51 apart. Total them
 * differently in two places and the invoice she sends disagrees with the
 * payment ledger by a cent forever, so a customer who pays the printed figure
 * exactly reads as permanently short.
 *
 * Structurally typed, with no Convex import, so `convex/` and
 * `components/invoice/` can both reach it (see the header note).
 */
export interface GroupableLine {
  menuItemId?: string | null;
  description?: string | null;
  qtyMilli: number;
  unitPriceCents: number;
}

export function mergeLines<T extends GroupableLine>(
  rows: T[],
): { rows: T[]; qtyMilli: number; unitPriceCents: number }[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = lineGroupKey(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  return [...buckets.values()].map((bucket) => ({
    rows: bucket,
    qtyMilli: bucket.reduce((sum, r) => sum + r.qtyMilli, 0),
    unitPriceCents: bucket[0].unitPriceCents,
  }));
}

export function computeInvoiceTotals(data: InvoiceTotalsInput): InvoiceTotals {
  const subtotalCents = data.lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const discountCents = Math.min(data.discountCents, subtotalCents);
  const goods = subtotalCents - discountCents;
  const { enabled, rateBp, inclusive } = data.tax;
  // Tax applies to goods, not the delivery fee.
  const taxAddedCents =
    enabled && !inclusive ? Math.round((goods * rateBp) / 10000) : 0;
  const taxIncludedCents =
    enabled && inclusive ? Math.round((goods * rateBp) / (10000 + rateBp)) : 0;
  const totalCents = goods + data.deliveryFeeCents + taxAddedCents;
  const depositCents = data.depositPercent
    ? Math.round((totalCents * data.depositPercent) / 100)
    : 0;
  return {
    subtotalCents,
    discountCents,
    deliveryFeeCents: data.deliveryFeeCents,
    taxAddedCents,
    taxIncludedCents,
    totalCents,
    depositCents,
  };
}

/**
 * Revenue the margin is measured against.
 *
 * Under an inclusive tax model `goods` CONTAINS tax that is not hers — a
 * 15.5% inclusive order would otherwise read about 13 points better than it
 * is. Under an exclusive model the tax sits outside `goods` already, so this
 * subtracts nothing.
 */
export function marginRevenueCents(totals: InvoiceTotals): number {
  return totals.subtotalCents - totals.discountCents - totals.taxIncludedCents;
}
