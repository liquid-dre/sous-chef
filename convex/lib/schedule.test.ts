// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  BUFFER,
  DEFAULT_CAPACITY_HOURS,
  consolidate,
  hoursByDay,
  monthGridDays,
  overCapacity,
  shiftDay,
  startDayFor,
  weekdayOf,
  windowFor,
  type Demand,
} from "./schedule";

/**
 * The arithmetic behind "start the brownies on Tuesday".
 *
 * Two tests carry the slice. That a three-day lead time on a Friday order puts
 * the start on Tuesday — the acceptance criterion, and the thing the whole
 * backward-scheduling idea is for. And that two orders share a batch only
 * while the food survives to the later one: merging a 24-hour cream bun across
 * three days would have Sous confidently telling her to serve something that
 * went off yesterday, which is worse than prompting twice.
 */

/** 2026-08-07 is a Friday; 2026-08-04 the Tuesday before. */
const FRIDAY = "2026-08-07";

function demand(over: Partial<Demand> = {}): Demand {
  return {
    orderId: "o1",
    who: "Tariro",
    deliveryDay: FRIDAY,
    menuItemId: "brownie",
    itemName: "Brownies",
    qtyMilli: 12_000,
    baseBatchYield: 12,
    leadTimeHours: null,
    batchProductionMinutes: 60,
    shelfLifeHours: 72,
    ...over,
  };
}

describe("working backwards to a start day", () => {
  test("ACCEPTANCE: a 3-day lead time on a Friday order starts on Tuesday", () => {
    expect(startDayFor(FRIDAY, 72, 60)).toBe("2026-08-04");
    expect(weekdayOf("2026-08-04")).toBe(2); // Tuesday, Sunday-zero
  });

  test("ACCEPTANCE: and it survives a month boundary", () => {
    // Tuesday 1 September back three days is Saturday 29 August — a naive
    // day-number subtraction gives "2026-09-(-2)".
    expect(startDayFor("2026-09-01", 72, 60)).toBe("2026-08-29");
    // And a year boundary, where a month-number comparison inverts.
    expect(startDayFor("2027-01-02", 72, 60)).toBe("2026-12-30");
  });

  test("the max binds from the batch side when there is no lead time", () => {
    // A 16-hour cake with nothing promised: 16h × 1.5 = 24h = one day.
    expect(startDayFor(FRIDAY, null, 16 * 60)).toBe("2026-08-06");
    // A really long bake pushes further back still.
    expect(startDayFor(FRIDAY, null, 40 * 60)).toBe("2026-08-04"); // 60h → 3d
  });

  test("the max binds from the lead-time side for a quick item", () => {
    // One hour of baking, three days promised. The promise wins.
    expect(startDayFor(FRIDAY, 72, 60)).toBe("2026-08-04");
    // And the reverse: one hour promised, a two-day bake. The bake wins.
    expect(startDayFor(FRIDAY, 1, 32 * 60)).toBe("2026-08-05"); // 48h → 2d
  });

  test("the buffer is applied to the bake, not to the promise", () => {
    // 24h of baking would be one day without the buffer; ×1.5 makes it 36h,
    // which rounds up to two.
    expect(BUFFER).toBe(1.5);
    expect(startDayFor(FRIDAY, null, 24 * 60)).toBe("2026-08-05");
  });

  test("part of a day still rounds to a whole day early, deliberately", () => {
    // A ten-minute bake gets a prompt the day before. That is the safe
    // direction and it is the price of matching the scope's own example: "a
    // batch taking a day prompts a start a day and a half ahead" only works
    // if 36 hours rounds UP to two days. Erring early costs one mild prompt;
    // erring late costs the order.
    expect(startDayFor(FRIDAY, null, 10)).toBe("2026-08-06");
    // Nothing to do at all is the one case that stays on the day.
    expect(startDayFor(FRIDAY, 0, 0)).toBe(FRIDAY);
    expect(startDayFor(FRIDAY, null, 0)).toBe(FRIDAY);
  });

  test("a start day in the past is reported, not clamped", () => {
    // An order taken today for tomorrow against a 3-day lead time is already
    // late. Saying so beats quietly moving the prompt to today and letting
    // her discover the problem on Friday.
    expect(startDayFor("2026-08-08", 72, 60)).toBe("2026-08-05");
  });
});

describe("consolidation", () => {
  test("ACCEPTANCE: two Thursday orders for one item make ONE prompt", () => {
    const prompts = consolidate([
      demand({ orderId: "a", who: "Tariro", deliveryDay: "2026-08-06", qtyMilli: 12_000 }),
      demand({ orderId: "b", who: "Rudo", deliveryDay: "2026-08-06", qtyMilli: 12_000 }),
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].covers).toHaveLength(2);
    expect(prompts[0].covers.map((c) => c.who)).toEqual(["Tariro", "Rudo"]);
    // 24 units at 12 to a batch is two batches, not two prompts of one.
    expect(prompts[0].qtyMilli).toBe(24_000);
    expect(prompts[0].batchCount).toBe(2);
  });

  test("ACCEPTANCE: shelf life decides whether Thursday and Saturday share", () => {
    const orders = [
      demand({ orderId: "a", who: "Tariro", deliveryDay: "2026-08-06" }),
      demand({ orderId: "b", who: "Rudo", deliveryDay: "2026-08-08" }),
    ];
    // 72 hours: one batch on Thursday is still good on Saturday.
    const long = consolidate(orders.map((o) => ({ ...o, shelfLifeHours: 72 })));
    expect(long).toHaveLength(1);
    expect(long[0].covers).toHaveLength(2);

    // 24 hours: it is not, and prompting once would be telling her to serve
    // two-day-old buns.
    const short = consolidate(orders.map((o) => ({ ...o, shelfLifeHours: 24 })));
    expect(short).toHaveLength(2);
    expect(short.every((p) => p.covers.length === 1)).toBe(true);
  });

  test("different items never merge, however close the dates", () => {
    const prompts = consolidate([
      demand({ orderId: "a", menuItemId: "brownie", itemName: "Brownies" }),
      demand({ orderId: "b", menuItemId: "scone", itemName: "Scones" }),
    ]);
    expect(prompts).toHaveLength(2);
    expect(prompts.map((p) => p.itemName).sort()).toEqual(["Brownies", "Scones"]);
  });

  test("the earliest delivery sets the start day, not the latest", () => {
    // Otherwise the batch is started too late for the order that needed it
    // first, which is the whole failure backward scheduling exists to avoid.
    const [prompt] = consolidate([
      demand({ orderId: "a", deliveryDay: "2026-08-06", leadTimeHours: 24 }),
      demand({ orderId: "b", deliveryDay: "2026-08-08", leadTimeHours: 24 }),
    ]);
    expect(prompt.startDay).toBe("2026-08-05");
    expect(prompt.firstDeliveryDay).toBe("2026-08-06");
    expect(prompt.lastDeliveryDay).toBe("2026-08-08");
  });

  test("a third order beyond the shelf life opens a second batch, not a third", () => {
    // Mon, Wed, and the following Monday, 72h shelf life. The first two share;
    // the third is on its own.
    const prompts = consolidate([
      demand({ orderId: "a", deliveryDay: "2026-08-03" }),
      demand({ orderId: "b", deliveryDay: "2026-08-05" }),
      demand({ orderId: "c", deliveryDay: "2026-08-17" }),
    ]);
    expect(prompts).toHaveLength(2);
    expect(prompts[0].covers.map((c) => c.orderId)).toEqual(["a", "b"]);
    expect(prompts[1].covers.map((c) => c.orderId)).toEqual(["c"]);
  });

  test("a sub-recipe with no shelf life merges everything", () => {
    // Null expiry is how production.isLive already reads an absent
    // overhangExpiresAt: it never goes off.
    const prompts = consolidate([
      demand({ orderId: "a", deliveryDay: "2026-08-03", shelfLifeHours: null }),
      demand({ orderId: "b", deliveryDay: "2026-09-30", shelfLifeHours: null }),
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].covers).toHaveLength(2);
  });

  test("the answer does not depend on the order rows arrive in", () => {
    const rows = [
      demand({ orderId: "c", deliveryDay: "2026-08-08" }),
      demand({ orderId: "a", deliveryDay: "2026-08-06" }),
      demand({ orderId: "b", deliveryDay: "2026-08-07" }),
    ];
    const a = consolidate(rows);
    const b = consolidate([...rows].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("nothing booked is no prompts, not a crash", () => {
    expect(consolidate([])).toEqual([]);
  });
});

describe("capacity", () => {
  test("hours sum across everything starting that day", () => {
    const prompts = consolidate([
      // 2 batches × 60 min = 2h, starting Thursday.
      demand({ orderId: "a", deliveryDay: "2026-08-06", qtyMilli: 24_000 }),
      // A different item, 1 batch × 180 min = 3h, same start day.
      demand({
        orderId: "b",
        menuItemId: "cake",
        itemName: "Cake",
        deliveryDay: "2026-08-06",
        qtyMilli: 1_000,
        baseBatchYield: 1,
        batchProductionMinutes: 180,
      }),
    ]);
    // Both start the day BEFORE the Thursday delivery, so the hours land
    // together on the start day — which is the day the capacity flag is
    // about. Charging them to the delivery day would flag the wrong one.
    const hours = hoursByDay(prompts);
    expect(hours.get("2026-08-05")).toBeCloseTo(5, 5);
    expect(hours.has("2026-08-06")).toBe(false);
  });

  test("over her own ceiling flags; under it does not", () => {
    expect(overCapacity(9.5, 8)).toBe(true);
    expect(overCapacity(8, 8)).toBe(false); // exactly a full day is not over
    expect(overCapacity(4, 8)).toBe(false);
  });

  test("an unset ceiling falls back to a working day, never to zero", () => {
    // Zero would flag every single day, which is how she learns to ignore it.
    expect(DEFAULT_CAPACITY_HOURS).toBe(8);
    expect(overCapacity(4, 0)).toBe(false);
    expect(overCapacity(9, 0)).toBe(true);
  });

  test("nothing scheduled is an empty map, not a zero for every day", () => {
    expect(hoursByDay([]).size).toBe(0);
  });
});

describe("the window", () => {
  test("a week runs Monday to Sunday, matching lib/period.ts", () => {
    // 2026-08-07 is a Friday.
    expect(windowFor("week", FRIDAY)).toEqual({
      start: "2026-08-03",
      end: "2026-08-09",
    });
    // Anchored on the Monday itself, the week does not jump back seven days.
    expect(windowFor("week", "2026-08-03").start).toBe("2026-08-03");
    // Anchored on the Sunday, it stays in the same week.
    expect(windowFor("week", "2026-08-09").start).toBe("2026-08-03");
  });

  test("a month runs first to last, including February and leap years", () => {
    expect(windowFor("month", FRIDAY)).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    expect(windowFor("month", "2026-02-14").end).toBe("2026-02-28");
    expect(windowFor("month", "2028-02-14").end).toBe("2028-02-29"); // leap
    expect(windowFor("month", "2026-04-10").end).toBe("2026-04-30");
  });

  test("the month grid is always six Monday-first weeks", () => {
    const days = monthGridDays(FRIDAY);
    expect(days).toHaveLength(42);
    expect(weekdayOf(days[0])).toBe(1); // Monday
    // It contains the whole month.
    expect(days).toContain("2026-08-01");
    expect(days).toContain("2026-08-31");
    // Fixed height: a five-week month still yields 42 cells, so the desktop
    // grid does not change height as she pages through.
    expect(monthGridDays("2026-02-14")).toHaveLength(42);
  });

  test("day arithmetic crosses months and years", () => {
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(weekdayOf("2026-08-09")).toBe(0); // a Sunday
  });
});
