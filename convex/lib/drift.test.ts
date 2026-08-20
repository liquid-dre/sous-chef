// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  driftFor,
  ingredientsCostCents,
  isPackUnitCompatible,
  marginsFor,
  median,
  menuItemImpact,
  packUnitsFor,
  toBaseMilli,
  unitPriceCentsPerThousand,
  MIN_PURCHASES_FOR_DRIFT,
  STALE_AFTER_DAYS,
} from "./drift";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

/** Three purchases at ~$1.85/kg — flour, quietly behaving. */
const STEADY = [185, 184, 186];

function drift(prices: number[], standard = 185, extra = {}) {
  return driftFor({
    standardCostCentsPerThousand: standard,
    standardCostSetAt: NOW - 10 * DAY,
    recentUnitPrices: prices,
    thresholdPercent: 10,
    now: NOW,
    ...extra,
  });
}

describe("units are sealed families", () => {
  test("pack units only offer their own family", () => {
    expect(packUnitsFor("g")).toEqual(["g", "kg"]);
    expect(packUnitsFor("ml")).toEqual(["ml", "L"]);
    expect(packUnitsFor("unit")).toEqual(["each", "dozen"]);
  });

  test("cross-family packs are rejected — no volume-to-mass, ever", () => {
    expect(isPackUnitCompatible("L", "g")).toBe(false);
    expect(isPackUnitCompatible("kg", "ml")).toBe(false);
    expect(isPackUnitCompatible("dozen", "g")).toBe(false);
    expect(isPackUnitCompatible("kg", "g")).toBe(true);
    expect(isPackUnitCompatible("dozen", "unit")).toBe(true);
  });

  test("within-family conversion is exact", () => {
    expect(toBaseMilli(2_000, "kg")).toBe(2_000_000); // 2 kg → 2,000,000 mg
    expect(toBaseMilli(500_000, "g")).toBe(500_000); // 500 g
    expect(toBaseMilli(1_000, "dozen")).toBe(12_000); // 1 dozen → 12 units
    expect(toBaseMilli(30_000, "each")).toBe(30_000); // 30 eggs
  });
});

describe("unit price", () => {
  test("2kg flour at $3.70 is $1.85/kg", () => {
    const qty = toBaseMilli(2_000, "kg");
    expect(unitPriceCentsPerThousand(370, qty)).toBe(185);
  });

  test("a tray of 30 eggs at $9.00 is $0.30 each", () => {
    const qty = toBaseMilli(30_000, "each"); // 30 eggs
    // Stored per 1000 base units: 30c each × 1000 = 30,000c per 1000 eggs.
    // The UI divides back down and shows her "$0.30 each".
    expect(unitPriceCentsPerThousand(900, qty)).toBe(30_000);
  });

  test("zero quantity never divides by zero", () => {
    expect(unitPriceCentsPerThousand(500, 0)).toBe(0);
  });
});

describe("median-of-3 — the whole point of the rule", () => {
  test("median ignores position and picks the middle", () => {
    expect(median([100, 300, 200])).toBe(200);
    expect(median([])).toBe(0);
    expect(median([100, 200])).toBe(150);
  });

  test("ACCEPTANCE: one emergency corner-shop run at double price does NOT fire", () => {
    // Newest first: today's panic butter, then two normal weeks.
    const d = drift([370, 185, 184]);
    expect(d.medianCentsPerThousand).toBe(185);
    expect(d.drifted).toBe(false);
    expect(d.severity).toBe("none");
  });

  test("ACCEPTANCE: three consecutive high prices DO fire", () => {
    const d = drift([215, 212, 210]);
    expect(d.medianCentsPerThousand).toBe(212);
    expect(d.percent).toBe(15);
    expect(d.drifted).toBe(true);
    expect(d.severity).toBe("amber");
  });

  test("only the last three count — older cheap history cannot dilute it", () => {
    const d = drift([215, 212, 210, 100, 100, 100]);
    expect(d.medianCentsPerThousand).toBe(212);
    expect(d.drifted).toBe(true);
  });

  test("severity escalates to red past twice the threshold", () => {
    expect(drift([230, 228, 226]).severity).toBe("red"); // +23%
    expect(drift([205, 204, 203]).severity).toBe("amber"); // +10%
  });

  test("drift is signed — a price fall is drift too", () => {
    const d = drift([150, 148, 152]);
    expect(d.percent).toBe(-19);
    expect(d.drifted).toBe(true);
  });
});

describe("thin evidence stays silent", () => {
  test(`fewer than ${MIN_PURCHASES_FOR_DRIFT} purchases produces no signal at all`, () => {
    for (const prices of [[], [200], [200, 199]]) {
      const d = drift(prices);
      expect(d.hasEnoughData).toBe(false);
      expect(d.medianCentsPerThousand).toBeNull();
      expect(d.percent).toBeNull();
      expect(d.drifted).toBe(false);
      expect(d.severity).toBe("none");
    }
  });

  test("a steady ingredient with plenty of data is simply quiet", () => {
    const d = drift(STEADY);
    expect(d.hasEnoughData).toBe(true);
    expect(d.drifted).toBe(false);
    expect(d.stale).toBe(false);
  });
});

describe("staleness is independent of purchases", () => {
  test(`${STALE_AFTER_DAYS} days since pricing flags even with zero purchases`, () => {
    const d = drift([], 185, { standardCostSetAt: NOW - 120 * DAY });
    expect(d.stale).toBe(true);
    expect(d.staleDays).toBe(120);
    expect(d.hasEnoughData).toBe(false); // still no drift signal
  });

  test("a recently-priced ingredient is not stale", () => {
    expect(drift(STEADY, 185, { standardCostSetAt: NOW - 5 * DAY }).stale)
      .toBe(false);
  });

  test("staleness fires at exactly 90 days", () => {
    const d = drift(STEADY, 185, { standardCostSetAt: NOW - 90 * DAY });
    expect(d.stale).toBe(true);
  });
});

describe("menu-item impact", () => {
  // A cake: 500g flour + 200g butter, direct; plus buttercream via a sub.
  const uses = [
    { ingredientId: "flour", qtyMilli: 500_000, viaPath: [] },
    { ingredientId: "butter", qtyMilli: 200_000, viaPath: ["Buttercream"] },
  ];
  const standard: Record<string, number> = { flour: 185, butter: 420 };
  const adopted: Record<string, number> = { flour: 185, butter: 485 };

  test("ingredient cost sums milli-quantities against per-1000 prices", () => {
    // 500g flour at $1.85/kg = $0.925 ; 200g butter at $4.20/kg = $0.84
    const cents = ingredientsCostCents(uses, (id) => standard[id]);
    expect(Math.round(cents)).toBe(Math.round(92.5 + 84));
  });

  test("margins: gross against variable, net against all three", () => {
    const m = marginsFor(3200, {
      ingredientsCents: 810,
      perUnitExtrasCents: 120,
      overheadCents: 230,
    });
    expect(m.grossPercent).toBe(71); // (3200-930)/3200
    expect(m.netPercent).toBe(64); // (3200-1160)/3200
  });

  test("ACCEPTANCE: every drifted ingredient is adopted at once, not one at a time", () => {
    const impact = menuItemImpact({
      priceCents: 3200,
      targetGrossPercent: 65,
      uses,
      perUnitExtrasCents: 120,
      overheadCents: 230,
      standardPrice: (id) => standard[id],
      adoptedPrice: (id) => adopted[id],
    });
    expect(impact.now.grossPercent).toBeGreaterThan(impact.ifAdopted.grossPercent);
    // Butter rising moves the cake's margin; both layers reported.
    expect(impact.ifAdopted.netPercent).toBeLessThan(impact.now.netPercent);
  });

  test("fallsBelowTarget only when adopting actually crosses the line", () => {
    // $10 item, 200g of an ingredient: $10/kg → 200c cost → 80% gross;
    // adopting $15/kg → 300c → 70%. Target 75% sits between the two.
    const crossing = menuItemImpact({
      priceCents: 1000,
      targetGrossPercent: 75,
      uses: [{ ingredientId: "butter", qtyMilli: 200_000, viaPath: [] }],
      perUnitExtrasCents: 0,
      overheadCents: 0,
      standardPrice: () => 1000,
      adoptedPrice: () => 1500,
    });
    expect(crossing.now.grossPercent).toBe(80);
    expect(crossing.ifAdopted.grossPercent).toBe(70);
    expect(crossing.fallsBelowTarget).toBe(true);

    // Already below target before adopting → not a new crossing.
    const alreadyBelow = menuItemImpact({
      priceCents: 1000,
      targetGrossPercent: 95,
      uses: [{ ingredientId: "butter", qtyMilli: 200_000, viaPath: [] }],
      perUnitExtrasCents: 0,
      overheadCents: 0,
      standardPrice: () => 1000,
      adoptedPrice: () => 1500,
    });
    expect(alreadyBelow.fallsBelowTarget).toBe(false);
  });
});
