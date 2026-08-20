// @vitest-environment node
import { describe, expect, test } from "vitest";
import { formatMarginTick, formatMoneyExact, formatMoneyTick } from "./format";
import { aggregateByGrain } from "./aggregate";

describe("chart formatters (DESIGN.md §4)", () => {
  test("exact money: 2dp, symbol, negatives parenthesised", () => {
    expect(formatMoneyExact(1240)).toBe("$12.40");
    expect(formatMoneyExact(0)).toBe("$0.00");
    expect(formatMoneyExact(-420)).toBe("($4.20)");
  });

  test("axis ticks abbreviate at $10k+, never below", () => {
    expect(formatMoneyTick(999_999)).toBe("$9,999.99");
    expect(formatMoneyTick(1_240_000)).toBe("$12.4k");
    expect(formatMoneyTick(12_000_000)).toBe("$120k");
    expect(formatMoneyTick(-1_240_000)).toBe("($12.4k)");
  });

  test("margins: whole percent", () => {
    expect(formatMarginTick(61.8)).toBe("62%");
    expect(formatMarginTick(0)).toBe("0%");
  });
});

describe("aggregateByGrain (the dense rule)", () => {
  const day = (i: number) => {
    const d = new Date(2026, 0, 1 + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  test("zero rows: empty, day grain, n = 0", () => {
    expect(aggregateByGrain([])).toEqual({ points: [], grain: "day", sampleSize: 0 });
  });

  test("one row: one point, n = 1", () => {
    const out = aggregateByGrain([{ date: "2026-08-01", revenueCents: 3200 }]);
    expect(out.points).toHaveLength(1);
    expect(out.grain).toBe("day");
    expect(out.sampleSize).toBe(1);
    expect(out.points[0].revenueCents).toBe(3200);
  });

  test("30 days stay daily", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ date: day(i), v: 1 }));
    const out = aggregateByGrain(rows);
    expect(out.grain).toBe("day");
    expect(out.points).toHaveLength(30);
  });

  test("800 days become monthly, ≤90 points, sums intact, honest n", () => {
    const rows = Array.from({ length: 800 }, (_, i) => ({ date: day(i), v: 2 }));
    const out = aggregateByGrain(rows);
    expect(out.grain).toBe("month");
    expect(out.points.length).toBeLessThanOrEqual(90);
    expect(out.sampleSize).toBe(800);
    const total = out.points.reduce((n, p) => n + p.v, 0);
    expect(total).toBe(1600);
  });

  test("200 days become weekly", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ date: day(i), v: 1 }));
    const out = aggregateByGrain(rows);
    expect(out.grain).toBe("week");
    expect(out.points.length).toBeLessThanOrEqual(90);
  });
});
