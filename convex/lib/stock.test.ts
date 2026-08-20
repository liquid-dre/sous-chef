// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  confidenceOf,
  epochDayOf,
  levelFrom,
  missedCountsBetween,
  runningLedger,
  stocktakeDueOn,
  subRecipeShortfalls,
  MISSED_COUNTS_FOR_DORMANT,
  PURCHASE_STALE_DAYS,
  type Movement,
} from "./stock";

/**
 * Where a silent lie about the pantry would live.
 *
 * Two tests here carry the slice. That a back-dated purchase cannot move a
 * level a physical count superseded — otherwise entering last Tuesday's
 * receipt on Friday inflates a number she measured with her own eyes. And
 * that two missed counts go DORMANT rather than continuing to print a
 * confident figure, because an alert built on unverified arithmetic spends
 * the trust the honest alerts run on.
 */

const KG = 1_000_000; // milli-base-units in a kilogram

function move(deltaMilli: number, occurredAt: number): Movement {
  return { deltaMilli, occurredAt };
}

describe("the level is the count plus what happened after it", () => {
  test("ACCEPTANCE: a back-dated purchase cannot move a counted level", () => {
    // Friday: she enters Tuesday's receipt. Thursday she counted 2kg.
    const anchor = { countedQtyMilli: 2 * KG, takenAt: 4_000 };
    const backDated = move(5 * KG, 2_000); // the Tuesday receipt
    expect(levelFrom(anchor, [backDated])).toBe(2 * KG);

    // And it is not silently discarded either — the same purchase, entered
    // before any count existed, is the whole basis of the estimate.
    expect(levelFrom(null, [backDated])).toBe(5 * KG);
  });

  test("movements after the count accumulate onto it", () => {
    const anchor = { countedQtyMilli: 2 * KG, takenAt: 4_000 };
    const level = levelFrom(anchor, [
      move(3 * KG, 5_000), // a shop
      move(-1 * KG, 6_000), // a batch
      move(-250_000, 7_000), // a dropped bag
    ]);
    expect(level).toBe(2 * KG + 3 * KG - 1 * KG - 250_000);
  });

  test("the stocktake's own variance movement is not counted twice", () => {
    // recordStocktake appends a variance movement stamped at exactly takenAt.
    // An inclusive comparison would add the discrepancy on top of the number
    // she counted and report it twice.
    const takenAt = 4_000;
    const variance = move(-500_000, takenAt);
    expect(levelFrom({ countedQtyMilli: 2 * KG, takenAt }, [variance])).toBe(
      2 * KG,
    );
  });

  test("with no anchor the whole ledger sums, in any order", () => {
    const movements = [move(-1 * KG, 9_000), move(5 * KG, 1_000), move(2 * KG, 3_000)];
    expect(levelFrom(null, movements)).toBe(6 * KG);
    expect(levelFrom(null, [...movements].reverse())).toBe(6 * KG);
  });

  test("a level is allowed to go negative", () => {
    // Negative IS the signal that the estimate has drifted from the shelf.
    // Clamping at zero would destroy the only evidence she has that
    // something is being used without being logged.
    expect(levelFrom(null, [move(-3 * KG, 1_000)])).toBe(-3 * KG);
  });

  test("nothing at all is zero, not a crash", () => {
    expect(levelFrom(null, [])).toBe(0);
    expect(levelFrom({ countedQtyMilli: 0, takenAt: 1 }, [])).toBe(0);
  });
});

describe("the ledger explains the number", () => {
  test("the last running total equals the level", () => {
    const anchor = { countedQtyMilli: 2 * KG, takenAt: 4_000 };
    const movements = [move(-1 * KG, 6_000), move(3 * KG, 5_000)];
    const rows = runningLedger(anchor, movements);
    expect(rows.at(-1)!.runningMilli).toBe(levelFrom(anchor, movements));
  });

  test("superseded rows are marked, kept, and move nothing", () => {
    const anchor = { countedQtyMilli: 2 * KG, takenAt: 4_000 };
    const rows = runningLedger(anchor, [move(5 * KG, 2_000), move(1 * KG, 5_000)]);
    expect(rows).toHaveLength(2);
    expect(rows[0].superseded).toBe(true);
    // The back-dated receipt is still IN the history and still renders — it
    // just does not move the running figure.
    expect(rows[0].runningMilli).toBe(2 * KG);
    expect(rows[1].superseded).toBe(false);
    expect(rows[1].runningMilli).toBe(3 * KG);
  });

  test("rows come back oldest first whatever order they arrived in", () => {
    const rows = runningLedger(null, [move(1, 300), move(1, 100), move(1, 200)]);
    expect(rows.map((r) => r.movement.occurredAt)).toEqual([100, 200, 300]);
  });
});

describe("missed counts", () => {
  // 2026-08-05 is a Wednesday; 2026-08-02 a Sunday.
  test("both ends excluded: the day she counted is not a day she missed", () => {
    // She counted ON Wednesday. The next Wednesday is today — due, not
    // missed. She has until the end of it.
    expect(missedCountsBetween("2026-08-05", "2026-08-12", 3)).toBe(0);
    // A day later, that Wednesday has been and gone.
    expect(missedCountsBetween("2026-08-05", "2026-08-13", 3)).toBe(1);
  });

  test("two Wednesdays gone is dormant", () => {
    expect(missedCountsBetween("2026-08-05", "2026-08-20", 3)).toBe(2);
  });

  test("ACCEPTANCE: the arithmetic survives a month boundary", () => {
    // 2026-08-26 (Wed) to 2026-09-10 (Thu) spans the end of August: the
    // Wednesdays at 2026-09-02 and 2026-09-09 have both passed.
    expect(missedCountsBetween("2026-08-26", "2026-09-10", 3)).toBe(2);
    // And a year boundary, where a naive month-number comparison inverts.
    expect(missedCountsBetween("2026-12-30", "2027-01-14", 3)).toBe(2);
  });

  test("with no chosen day the cadence is still weekly", () => {
    expect(missedCountsBetween("2026-08-05", "2026-08-11", null)).toBe(0);
    expect(missedCountsBetween("2026-08-05", "2026-08-13", null)).toBe(1);
    expect(missedCountsBetween("2026-08-05", "2026-08-20", null)).toBe(2);
  });

  test("counted today, or in the future, is never a miss", () => {
    expect(missedCountsBetween("2026-08-05", "2026-08-05", 3)).toBe(0);
    expect(missedCountsBetween("2026-08-06", "2026-08-05", 3)).toBe(0);
  });

  test("stocktake day is Sunday-zero, matching orgs.stocktakeDay", () => {
    expect(stocktakeDueOn("2026-08-09", 0)).toBe(true); // a Sunday
    expect(stocktakeDueOn("2026-08-05", 3)).toBe(true); // a Wednesday
    expect(stocktakeDueOn("2026-08-05", 4)).toBe(false);
    expect(stocktakeDueOn("2026-08-05", null)).toBe(false);
  });

  test("epoch days are pure string arithmetic, no timezone", () => {
    expect(epochDayOf("1970-01-01")).toBe(0);
    expect(epochDayOf("2026-08-05") - epochDayOf("2026-08-04")).toBe(1);
  });
});

describe("confidence", () => {
  const base = {
    lastPurchaseOn: "2026-08-04",
    today: "2026-08-05",
    stocktakeDay: 3,
  };

  test("counted on schedule is fresh", () => {
    const c = confidenceOf({ ...base, lastCountedOn: "2026-08-05" });
    expect(c.state).toBe("fresh");
    expect(c.daysSinceCount).toBe(0);
    expect(c.missedCounts).toBe(0);
  });

  test("fresh → stale → dormant as the Wednesdays go by", () => {
    const at = (today: string) =>
      confidenceOf({ ...base, lastCountedOn: "2026-08-05", today, lastPurchaseOn: today });
    expect(at("2026-08-12").state).toBe("fresh"); // due today
    expect(at("2026-08-13").state).toBe("stale"); // one gone
    expect(at("2026-08-20").state).toBe("dormant"); // two gone
    expect(at("2026-08-20").missedCounts).toBe(MISSED_COUNTS_FOR_DORMANT);
  });

  test("ACCEPTANCE: stale purchase logging softens confidence on its own", () => {
    // She counted this morning, so nothing is missed — but Sous has not seen
    // a receipt in a fortnight and cannot claim to know what arrived.
    const c = confidenceOf({
      ...base,
      lastCountedOn: "2026-08-05",
      lastPurchaseOn: "2026-07-22", // 14 days
    });
    expect(c.daysSincePurchase).toBe(PURCHASE_STALE_DAYS);
    expect(c.purchaseLoggingStale).toBe(true);
    expect(c.state).toBe("stale");
  });

  test("a kitchen that has never bought anything is not stale", () => {
    // There is nothing to be out of date about; the pantry is empty.
    const c = confidenceOf({
      ...base,
      lastCountedOn: "2026-08-05",
      lastPurchaseOn: null,
    });
    expect(c.purchaseLoggingStale).toBe(false);
    expect(c.state).toBe("fresh");
  });

  test("never counted is its own state, not a very stale one", () => {
    // An estimate built entirely from receipts and recipes is a different
    // claim from a decayed one, and needs different words on screen.
    const c = confidenceOf({ ...base, lastCountedOn: null });
    expect(c.state).toBe("neverCounted");
    expect(c.daysSinceCount).toBeNull();
    expect(c.missedCounts).toBe(0);
  });

  test("dormant outranks stale receipts rather than being masked by them", () => {
    const c = confidenceOf({
      ...base,
      lastCountedOn: "2026-08-05",
      lastPurchaseOn: "2026-08-19",
      today: "2026-08-20",
    });
    expect(c.state).toBe("dormant");
  });
});

describe("sub-recipe shortfalls", () => {
  const buttercream = {
    subMenuItemId: "bc",
    name: "Buttercream",
    qtyMilliPerBatch: 1_500, // 1.5 units per batch of brownies
    onHandMilli: 0,
    baseBatchYield: 4,
  };

  test("enough on the shelf is not a shortfall", () => {
    expect(
      subRecipeShortfalls([{ ...buttercream, onHandMilli: 3_000 }], 2),
    ).toEqual([]);
  });

  test("whole batches only, rounded up", () => {
    // Two batches of brownies want 3 units; the shelf has 1; 2 short; one
    // batch of buttercream yields 4, so one batch covers it.
    const [short] = subRecipeShortfalls(
      [{ ...buttercream, onHandMilli: 1_000 }],
      2,
    );
    expect(short.neededMilli).toBe(3_000);
    expect(short.shortMilli).toBe(2_000);
    expect(short.batchesToCover).toBe(1);
  });

  test("a big shortfall needs more than one batch", () => {
    // 10 batches want 15 units, nothing on hand, 4 to a batch → 4 batches.
    const [short] = subRecipeShortfalls([buttercream], 10);
    expect(short.batchesToCover).toBe(4);
  });

  test("exactly covered by a whole number of batches does not round up", () => {
    // 8 units short, 4 to a batch → exactly 2, not 3.
    const [short] = subRecipeShortfalls(
      [{ ...buttercream, qtyMilliPerBatch: 8_000 }],
      1,
    );
    expect(short.batchesToCover).toBe(2);
  });

  test("a sub that yields nothing gives a finite answer, not Infinity", () => {
    // A zero-yield sub-recipe is a data error, not a scenario — but dividing
    // by it would put Infinity on screen and NaN through every arithmetic
    // downstream. Substituting a yield of one keeps the prompt sayable.
    const [short] = subRecipeShortfalls([{ ...buttercream, baseBatchYield: 0 }], 1);
    expect(Number.isFinite(short.batchesToCover)).toBe(true);
    expect(short.batchesToCover).toBeGreaterThanOrEqual(1);
  });
});
