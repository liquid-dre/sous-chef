// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { boundsFor, boundsForDay, dayInTimeZone } from "./period";

/**
 * The period arithmetic, which now has a second caller: Home renders its claim
 * on the SERVER, and if the server and the client disagreed about which month
 * it is, hydration would swap one set of numbers for another in front of her.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("bounds from a domain day", () => {
  test("a month runs from the 1st to her today", () => {
    expect(boundsForDay("month", "2026-08-04")).toEqual({
      start: "2026-08-01",
      end: "2026-08-04",
    });
  });

  test("a week starts on Monday", () => {
    // 2026-08-04 is a Tuesday.
    expect(boundsForDay("week", "2026-08-04")).toEqual({
      start: "2026-08-03",
      end: "2026-08-04",
    });
    // …and a Monday is its own start, not the previous week's.
    expect(boundsForDay("week", "2026-08-03").start).toBe("2026-08-03");
    // A Sunday belongs to the week that began six days earlier.
    expect(boundsForDay("week", "2026-08-09").start).toBe("2026-08-03");
  });

  test("a quarter is this month plus the two before it", () => {
    expect(boundsForDay("quarter", "2026-08-04").start).toBe("2026-06-01");
    // Across the year boundary, which is where naive month arithmetic breaks.
    expect(boundsForDay("quarter", "2026-01-15").start).toBe("2025-11-01");
  });

  test("all time has no start at all, rather than a very old one", () => {
    expect(boundsForDay("all", "2026-08-04")).toEqual({ end: "2026-08-04" });
  });

  test("ACCEPTANCE: the boundary day does not move with the server's offset", () => {
    // The 1st is the day that matters: get it wrong and Home silently shows
    // last month. Construction and read-back both happen in process-local
    // time, so the offset cancels.
    //
    // Note this assertion cannot prove that on its own — Node fixes its
    // timezone at startup and vi.stubEnv("TZ") does not move it. The real
    // proof is running this file with TZ set in the environment, which is done
    // for Pacific/Kiritimati (UTC+14) and Pacific/Midway (UTC-11).
    expect(boundsForDay("month", "2026-08-01")).toEqual({
      start: "2026-08-01",
      end: "2026-08-01",
    });
    expect(boundsForDay("month", "2026-12-31").start).toBe("2026-12-01");
    expect(boundsForDay("year", "2026-01-01").start).toBe("2026-01-01");
  });
});

describe("her today, from a timezone the browser reported", () => {
  test("is the domain-day shape the schema uses", () => {
    vi.setSystemTime(new Date("2026-08-04T09:00:00Z"));
    expect(dayInTimeZone("Africa/Harare")).toBe("2026-08-04");
  });

  test("ACCEPTANCE: late evening in Harare is still today, not tomorrow", () => {
    // 22:00 in Harare is 20:00 UTC — same day either way.
    vi.setSystemTime(new Date("2026-08-04T20:00:00Z"));
    expect(dayInTimeZone("Africa/Harare")).toBe("2026-08-04");
    // But 01:00 Harare on the 5th is 23:00 UTC on the 4th. A server using UTC
    // would file her order into yesterday; this does not.
    vi.setSystemTime(new Date("2026-08-04T23:00:00Z"));
    expect(dayInTimeZone("Africa/Harare")).toBe("2026-08-05");
    expect(dayInTimeZone("UTC")).toBe("2026-08-04");
  });

  test("a tampered or unknown timezone declines rather than guessing", () => {
    // Null makes the caller fall back to the client, which does know. A wrong
    // month boundary would be a number Sous cannot stand behind.
    expect(dayInTimeZone("Not/APlace")).toBeNull();
    expect(dayInTimeZone("")).toBeNull();
    expect(dayInTimeZone("'; DROP TABLE orders; --")).toBeNull();
  });
});

describe("the Date-based entry point still behaves", () => {
  test("boundsFor and boundsForDay agree about the same day", () => {
    vi.setSystemTime(new Date("2026-08-04T09:00:00Z"));
    expect(boundsFor("month", new Date(2026, 7, 4, 12))).toEqual(
      boundsForDay("month", "2026-08-04"),
    );
  });
});
