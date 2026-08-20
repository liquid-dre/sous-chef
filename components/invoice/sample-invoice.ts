import type { InvoicePreviewData } from "./invoice-preview";

/**
 * Realistic sample data for the live preview — never lorem ipsum. These are
 * the numbers the preview does real arithmetic on while she edits settings;
 * only the org-shaped fields get overridden by her form state.
 */
export const SAMPLE_INVOICE: InvoicePreviewData = {
  org: {
    name: "Rutendo's Kitchen",
    logoUrl: null,
    address: "14 Baines Ave, Harare",
    phone: "+263 77 234 5678",
    email: "orders@rutendos.kitchen",
    socials: [{ label: "@rutendoskitchen", url: "https://instagram.com/rutendoskitchen" }],
  },
  invoice: { prefix: "INV", number: 1, revision: 0 },
  customer: {
    name: "Tariro Moyo",
    phone: "+263 71 555 0184",
    address: "22 Josiah Tongogara Ave",
  },
  orderDate: "2026-08-01",
  deliveryDate: "2026-08-03",
  lines: [
    { description: "Brownies", qtyMilli: 12_000, unitPriceCents: 300 },
    { description: "Chocolate fudge cake", qtyMilli: 1_000, unitPriceCents: 3200 },
    { description: "Lemon tartlets", qtyMilli: 6_000, unitPriceCents: 250 },
  ],
  deliveryFeeCents: 500,
  discountCents: 200,
  tax: { enabled: false, rateBp: 0, inclusive: false },
  depositPercent: 50,
  paymentInstructions: "EcoCash 0770 000 000 (Rutendo M.)\nCBZ 0123 4567 8901 — Rutendo's Kitchen",
  terms: "Orders confirm on deposit. 48 hours' notice for cancellations.",
  zwgRateMilli: null,
};
