// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  computeInvoiceTotals,
  lineTotalCents,
} from "./invoice-preview";
import { SAMPLE_INVOICE } from "./sample-invoice";

/**
 * The preview's arithmetic IS the invoice arithmetic 3.1 inherits — integer
 * cents, tax on goods not delivery, inclusive vs exclusive rendered as
 * different numbers, never floats.
 */
describe("invoice totals", () => {
  test("line totals honour milli-quantities", () => {
    expect(lineTotalCents({ description: "", qtyMilli: 12_000, unitPriceCents: 300 })).toBe(3600);
    expect(lineTotalCents({ description: "", qtyMilli: 1_500, unitPriceCents: 300 })).toBe(450);
  });

  test("sample invoice: subtotal, discount, delivery, deposit", () => {
    const t = computeInvoiceTotals(SAMPLE_INVOICE);
    expect(t.subtotalCents).toBe(8300);
    expect(t.discountCents).toBe(200);
    expect(t.totalCents).toBe(8300 - 200 + 500);
    expect(t.depositCents).toBe(Math.round((8300 - 200 + 500) / 2));
  });

  test("exclusive tax is added on goods, not delivery", () => {
    const t = computeInvoiceTotals({
      ...SAMPLE_INVOICE,
      tax: { enabled: true, rateBp: 1550, inclusive: false },
    });
    const goods = 8300 - 200;
    expect(t.taxAddedCents).toBe(Math.round((goods * 1550) / 10000));
    expect(t.taxIncludedCents).toBe(0);
    expect(t.totalCents).toBe(goods + 500 + t.taxAddedCents);
  });

  test("inclusive tax leaves the total alone and states what it contains", () => {
    const t = computeInvoiceTotals({
      ...SAMPLE_INVOICE,
      tax: { enabled: true, rateBp: 1550, inclusive: true },
    });
    const goods = 8300 - 200;
    expect(t.totalCents).toBe(goods + 500);
    expect(t.taxAddedCents).toBe(0);
    expect(t.taxIncludedCents).toBe(Math.round((goods * 1550) / (10000 + 1550)));
  });

  test("a discount larger than the goods never goes negative", () => {
    const t = computeInvoiceTotals({ ...SAMPLE_INVOICE, discountCents: 999999 });
    expect(t.discountCents).toBe(t.subtotalCents);
    expect(t.totalCents).toBe(SAMPLE_INVOICE.deliveryFeeCents);
  });
});
