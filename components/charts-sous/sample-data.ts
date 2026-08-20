import type { DayRow } from "./aggregate";

/**
 * Deterministic sample data for /design-system/charts — realistic kitchen
 * numbers, never lorem, and stable across reloads so screenshots and gate
 * reviews compare like with like. Seeded PRNG; no Math.random.
 */

export type ChartDataState = "normal" | "empty" | "single" | "dense";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayString(daysAgo: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - daysAgo);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Daily revenue rows with the three cost layers attached (traceability). */
export function revenueRows(state: ChartDataState): DayRow[] {
  if (state === "empty") return [];
  const days = state === "single" ? 1 : state === "dense" ? 800 : 90;
  const rand = mulberry32(7);
  const rows: DayRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const weekend = [0, 6].includes(new Date(dayString(i) + "T00:00").getDay());
    const orders =
      state === "single"
        ? 3 // the specimen's one data point should be a real sale, not $0.00
        : Math.max(0, Math.round(rand() * (weekend ? 9 : 5)));
    const revenueCents = orders * Math.round(2400 + rand() * 2400);
    const ingredientsCents = Math.round(revenueCents * 0.31);
    const perUnitExtrasCents = Math.round(revenueCents * 0.06);
    const overheadCents = Math.round(revenueCents * 0.09);
    rows.push({
      date: dayString(i),
      revenueCents,
      ingredientsCents,
      perUnitExtrasCents,
      overheadCents,
      netCents:
        revenueCents - ingredientsCents - perUnitExtrasCents - overheadCents -
        // a rough weekly fixed drag makes some quiet days genuinely negative
        Math.round(1800 + rand() * 1200),
      orders,
    });
  }
  return rows;
}

export const MENU_ITEMS = [
  { name: "Chocolate fudge cake", marginPercent: 68, priceCents: 3200, soldMilli: 41_000 },
  { name: "Brownies (dozen)", marginPercent: 61, priceCents: 3600, soldMilli: 65_000 },
  { name: "Lemon tartlets (6)", marginPercent: 55, priceCents: 1500, soldMilli: 38_000 },
  { name: "Sourdough loaf", marginPercent: 47, priceCents: 850, soldMilli: 82_000 },
  { name: "Beef pies (4)", marginPercent: 38, priceCents: 2400, soldMilli: 29_000 },
  { name: "Wedding cake deposit tier", marginPercent: 72, priceCents: 18_000, soldMilli: 3_000 },
] as const;

/** Stocktake variance per ingredient. Bklit bars render magnitudes only
 * (no negative values in this version), so the diverging semantic is a
 * paired series: over in profit green, short in warning amber — direction
 * carried by colour and the tooltip's signed money figure. */
export const VARIANCE_ROWS = [
  { name: "Flour", overCents: 0, shortCents: 420 },
  { name: "Butter", overCents: 310, shortCents: 0 },
  { name: "Sugar", overCents: 0, shortCents: 180 },
  { name: "Eggs", overCents: 150, shortCents: 0 },
  { name: "Cocoa", overCents: 0, shortCents: 640 },
] as const;

export function scatterPoints(state: ChartDataState) {
  if (state === "empty") return [];
  const rand = mulberry32(21);
  const count = state === "single" ? 1 : state === "dense" ? 800 : 24;
  const points = Array.from({ length: count }, (_, i) => ({
    date: new Date(2026, 0, 1 + (i % 200)),
    priceCents: Math.round(600 + rand() * 3400),
    marginPercent: Math.round(30 + rand() * 45),
  }));
  // Mobile rule: scatter thins before rendering — never a smear.
  return points.length > 200 ? points.filter((_, i) => i % 4 === 0) : points;
}

export const SENSORY_METRICS = [
  { key: "sweetness", label: "Sweetness" },
  { key: "moisture", label: "Moisture" },
  { key: "richness", label: "Richness" },
  { key: "portionSize", label: "Portion" },
  { key: "doneness", label: "Doneness" },
];

/** 50 = "just right" (the diverging midpoint mapped onto Bklit's 0–100). */
export const SENSORY_TARGET = {
  label: "Just right",
  color: "var(--chart-target)",
  values: { sweetness: 50, moisture: 50, richness: 50, portionSize: 50, doneness: 50 },
};

export const SENSORY_RATINGS = {
  label: "Customers (n = 23)",
  color: "var(--chart-1)",
  values: { sweetness: 63, moisture: 46, richness: 55, portionSize: 38, doneness: 52 },
};

export function heatmapColumns(state: ChartDataState) {
  if (state === "empty") return [];
  const rand = mulberry32(3);
  const weeks = state === "single" ? 1 : state === "dense" ? 52 : 26;
  return Array.from({ length: weeks }, (_, w) => ({
    bin: w,
    bins: Array.from({ length: 7 }, (_, d) => ({
      bin: d,
      count:
        state === "single" && !(w === 0 && d === 2)
          ? 0
          : Math.max(0, Math.round(rand() * 6 - 1)),
      date: new Date(2026, 0, 5 + w * 7 + d),
    })),
  }));
}

/** Where the money went last month: each item's revenue splits into the
 * three cost layers and what was left. Every cent lands somewhere. */
export const SANKEY_DATA = {
  nodes: [
    { name: "Fudge cake" },
    { name: "Brownies" },
    { name: "Sourdough" },
    { name: "Ingredients" },
    { name: "Packaging" },
    { name: "Overhead" },
    { name: "Kept" },
  ],
  links: [
    { source: 0, target: 3, value: 13100 },
    { source: 0, target: 4, value: 2500 },
    { source: 0, target: 5, value: 3700 },
    { source: 0, target: 6, value: 21900 },
    { source: 1, target: 3, value: 9700 },
    { source: 1, target: 4, value: 1900 },
    { source: 1, target: 5, value: 2600 },
    { source: 1, target: 6, value: 14200 },
    { source: 2, target: 3, value: 8100 },
    { source: 2, target: 4, value: 900 },
    { source: 2, target: 5, value: 2300 },
    { source: 2, target: 6, value: 7300 },
  ],
};

export const SUNBURST_DATA = {
  name: "Menu",
  children: [
    {
      name: "Cakes",
      children: [
        { name: "Fudge cake", value: 41200 },
        { name: "Carrot cake", value: 12800 },
      ],
    },
    {
      name: "Bakes",
      children: [
        { name: "Brownies", value: 28400 },
        { name: "Tartlets", value: 15000 },
      ],
    },
    { name: "Bread", children: [{ name: "Sourdough", value: 18600 }] },
  ],
};
