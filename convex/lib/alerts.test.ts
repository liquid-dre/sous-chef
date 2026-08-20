// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  AMBER_WEEKS,
  HORIZON_DAYS,
  MIN_WEEKS_FOR_TYPICAL,
  degrade,
  horizonEnd,
  runwayFor,
  severityOf,
  shouldResurfaceAlert,
  trustFrom,
  typicalWeeklyMilli,
  withinHorizon,
  type UsageMovement,
} from "./alerts";

/**
 * The rules that decide whether Sous speaks, and how loudly.
 *
 * Two tests carry the slice. That a kitchen with ZERO history still gets a
 * red when its confirmed orders cannot be covered — because that is
 * arithmetic, not a guess, and a feature that stays dark for a month is a
 * feature she never learns to trust. And that a stale pantry cannot raise one
 * at all, because red compares the order book against the stock figure and
 * the stock figure is exactly the thing that has gone stale.
 */

const KG = 1_000_000;
const MS_DAY = 86_400_000;
const TODAY = "2026-08-05"; // a Wednesday

/** An instant N days before the end of TODAY. */
function daysAgo(n: number): number {
  return Date.parse(`${TODAY}T00:00:00Z`) + MS_DAY - 1 - n * MS_DAY;
}

function used(ingredientId: string, milli: number, dayseAgo: number): UsageMovement {
  return { ingredientId, deltaMilli: -milli, occurredAt: daysAgo(dayseAgo) };
}

describe("the horizon", () => {
  test("ACCEPTANCE: a Friday order is inside the window, a later one is not", () => {
    // Wednesday 5 Aug. The window runs to Tuesday 11 Aug inclusive.
    expect(horizonEnd(TODAY)).toBe("2026-08-11");
    expect(withinHorizon("2026-08-07", TODAY)).toBe(true); // Friday
    expect(withinHorizon("2026-08-11", TODAY)).toBe(true); // last day
    expect(withinHorizon("2026-08-12", TODAY)).toBe(false); // one past
    expect(withinHorizon("2026-08-04", TODAY)).toBe(false); // yesterday
  });

  test("ACCEPTANCE: it survives a month boundary", () => {
    // From 28 Aug the window runs into September; a naive day-number
    // comparison inverts here.
    expect(horizonEnd("2026-08-28")).toBe("2026-09-03");
    expect(withinHorizon("2026-09-02", "2026-08-28")).toBe(true);
    expect(withinHorizon("2026-09-04", "2026-08-28")).toBe(false);
  });

  test("and a year boundary", () => {
    expect(horizonEnd("2026-12-30")).toBe("2027-01-05");
    expect(withinHorizon("2027-01-02", "2026-12-30")).toBe(true);
  });

  test("today itself counts", () => {
    expect(withinHorizon(TODAY, TODAY)).toBe(true);
  });
});

describe("typical weekly usage", () => {
  test("the median week, not the mean", () => {
    // Four weeks: 1kg, 1kg, 1kg, and one 10kg wedding. The mean is 3.25kg and
    // would leave amber lit for months; the median says a normal week is 1kg.
    const movements = [
      used("flour", 1 * KG, 1),
      used("flour", 1 * KG, 8),
      used("flour", 1 * KG, 15),
      used("flour", 10 * KG, 22),
    ];
    expect(typicalWeeklyMilli(movements, TODAY).get("flour")).toBe(1 * KG);
  });

  test("a quiet week counts as zero rather than being skipped", () => {
    // Used in weeks 0 and 2 but not week 1. An ingredient used intermittently
    // is NOT one that gets through a kilo every week, and dropping the quiet
    // week would claim exactly that.
    const movements = [used("flour", 1 * KG, 1), used("flour", 1 * KG, 15)];
    // Series is [1kg, 0, 1kg] → median 1kg. The zero pulls it down from what
    // averaging only the busy weeks would give.
    expect(typicalWeeklyMilli(movements, TODAY).get("flour")).toBe(1 * KG);

    const sparse = [used("flour", 3 * KG, 1), used("flour", 1 * KG, 22)];
    // [3kg, 0, 0, 1kg] → median 0.5kg, not 2kg.
    expect(typicalWeeklyMilli(sparse, TODAY).get("flour")).toBe(500_000);
  });

  test("ACCEPTANCE: too little history says nothing at all", () => {
    // Two weeks is not a typical week. Absence means "Sous does not know",
    // and every caller must read it that way rather than substituting zero.
    const movements = [used("flour", 1 * KG, 1), used("flour", 1 * KG, 8)];
    expect(typicalWeeklyMilli(movements, TODAY).has("flour")).toBe(false);
    expect(MIN_WEEKS_FOR_TYPICAL).toBe(3);
  });

  test("purchases are ignored — only consumption counts", () => {
    const movements: UsageMovement[] = [
      { ingredientId: "flour", deltaMilli: +50 * KG, occurredAt: daysAgo(1) },
      { ingredientId: "flour", deltaMilli: +50 * KG, occurredAt: daysAgo(8) },
      { ingredientId: "flour", deltaMilli: +50 * KG, occurredAt: daysAgo(15) },
    ];
    expect(typicalWeeklyMilli(movements, TODAY).has("flour")).toBe(false);
  });

  test("movements outside the window are excluded", () => {
    const old = [
      used("flour", 1 * KG, 100),
      used("flour", 1 * KG, 107),
      used("flour", 1 * KG, 114),
    ];
    expect(typicalWeeklyMilli(old, TODAY).has("flour")).toBe(false);
  });

  test("nothing at all is an empty map, not a crash", () => {
    expect(typicalWeeklyMilli([], TODAY).size).toBe(0);
  });
});

describe("runway and severity", () => {
  const base = {
    ingredientId: "milk",
    name: "Milk",
    onHandMilli: 2 * KG,
    bookedMilli: 0,
    typicalWeeklyMilli: null,
  };

  test("ACCEPTANCE: red with ZERO history, from the order book alone", () => {
    // Three orders need 8 litres; there are 2. That is a fact about food she
    // has already promised, and it holds on the kitchen's first day.
    const runway = runwayFor({ ...base, bookedMilli: 8 * KG });
    expect(runway.bookedShort).toBe(true);
    expect(runway.shortMilli).toBe(6 * KG);
    expect(severityOf(runway, null)).toBe("red");
  });

  test("the booked orders being covered is not an alert on its own", () => {
    const runway = runwayFor({ ...base, onHandMilli: 20 * KG, bookedMilli: 8 * KG });
    expect(runway.bookedShort).toBe(false);
    expect(severityOf(runway, null)).toBeNull();
  });

  test("amber needs history, and stays silent without it", () => {
    // Covered this week, with very little spare. Without a measured rate
    // Sous has nothing to compare the leftover against, so it says nothing.
    const runway = runwayFor({ ...base, onHandMilli: 9 * KG, bookedMilli: 8 * KG });
    expect(severityOf(runway, null)).toBeNull();
    // With a rate, the same leftover is under one typical week → amber.
    expect(severityOf(runway, 5 * KG)).toBe("amber");
  });

  test("comfortably stocked is silent even with history", () => {
    const runway = runwayFor({ ...base, onHandMilli: 40 * KG, bookedMilli: 8 * KG });
    expect(severityOf(runway, 5 * KG)).toBeNull();
    expect(AMBER_WEEKS).toBe(1);
  });

  test("days of cover: short inside the horizon, longer beyond it", () => {
    // 2 of 8 litres, straight-lined across the week → under 2 days.
    const short = runwayFor({ ...base, onHandMilli: 2 * KG, bookedMilli: 8 * KG });
    expect(short.daysOfCover).toBe(1);

    // Covered, plus two typical weeks spare → the horizon plus 14 days.
    const long = runwayFor({
      ...base,
      onHandMilli: 18 * KG,
      bookedMilli: 8 * KG,
      typicalWeeklyMilli: 5 * KG,
    });
    expect(long.daysOfCover).toBe(HORIZON_DAYS + 14);
  });

  test("no demand and no history is a genuine null, never a fabricated number", () => {
    const runway = runwayFor({ ...base, onHandMilli: 2 * KG, bookedMilli: 0 });
    expect(runway.daysOfCover).toBeNull();
    expect(severityOf(runway, null)).toBeNull();
  });

  test("booked demand with no history reports the horizon and no more", () => {
    // Sous can say the week is covered. It cannot see past that, and saying
    // so beats claiming a runway it has no basis for.
    const runway = runwayFor({ ...base, onHandMilli: 20 * KG, bookedMilli: 8 * KG });
    expect(runway.daysOfCover).toBe(HORIZON_DAYS);
  });
});

describe("degradation", () => {
  test("the four confidence states map onto three levels of trust", () => {
    expect(trustFrom("fresh")).toBe("trusted");
    expect(trustFrom("stale")).toBe("hedged");
    // An estimate nobody has ever confirmed is not more trustworthy than one
    // that has gone out of date.
    expect(trustFrom("neverCounted")).toBe("hedged");
    expect(trustFrom("dormant")).toBe("dormant");
  });

  test("ACCEPTANCE: a stale pantry suppresses red entirely", () => {
    // Red compares the order book against the STOCK figure, and the stock
    // figure is exactly what has gone stale.
    expect(degrade("red", "hedged")).toBe("amber");
    expect(degrade("red", "trusted")).toBe("red");
  });

  test("amber survives hedging — it was always an estimate", () => {
    expect(degrade("amber", "hedged")).toBe("amber");
  });

  test("ACCEPTANCE: dormant raises nothing per ingredient", () => {
    // The caller replaces the whole list with one line. Eleven hedged alerts
    // on a fortnight of unverified arithmetic is the same trust leak as two
    // wrong reds, only slower.
    expect(degrade("red", "dormant")).toBeNull();
    expect(degrade("amber", "dormant")).toBeNull();
  });

  test("silence stays silent in every state", () => {
    expect(degrade(null, "trusted")).toBeNull();
    expect(degrade(null, "hedged")).toBeNull();
    expect(degrade(null, "dormant")).toBeNull();
  });
});

describe("resurfacing a resolved alert", () => {
  test("the same problem stays quiet", () => {
    const resolution = { shortfallAtResolutionMilli: 4 * KG };
    expect(shouldResurfaceAlert(resolution, 4 * KG)).toBe(false);
    expect(shouldResurfaceAlert(resolution, 4.5 * KG)).toBe(false); // +12.5%
  });

  test("a materially worse one comes back", () => {
    const resolution = { shortfallAtResolutionMilli: 4 * KG };
    expect(shouldResurfaceAlert(resolution, 6 * KG)).toBe(true); // +50%
  });

  test("an IMPROVING shortfall never comes back", () => {
    // She resolved "short 4 litres"; buying some makes it 1. That is the
    // resolution working, not a new problem.
    const resolution = { shortfallAtResolutionMilli: 4 * KG };
    expect(shouldResurfaceAlert(resolution, 1 * KG)).toBe(false);
    expect(shouldResurfaceAlert(resolution, 0)).toBe(false);
  });

  test("a shortfall appearing where there was none is material", () => {
    expect(shouldResurfaceAlert({ shortfallAtResolutionMilli: 0 }, 1)).toBe(true);
    expect(shouldResurfaceAlert({ shortfallAtResolutionMilli: 0 }, 0)).toBe(false);
  });
});
