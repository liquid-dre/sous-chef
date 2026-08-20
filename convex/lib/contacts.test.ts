// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  DECISION_DAYS,
  OCCASION_LABEL,
  RECURRING,
  daysBetween,
  dueReminders,
  nextAnniversary,
  occasionMix,
  recurs,
  reminderKey,
  reminderLeadDays,
  repeatSplit,
  type Occasion,
  type OrderFact,
} from "./contacts";

/**
 * The rules behind reaching out to a real person.
 *
 * The test that carries the slice names all SEVEN occasion chips one by one.
 * That is deliberate over a loop: an eighth chip added in six months makes
 * this file fail to compile against the exhaustive record, which is the point
 * — CONTEXT.md calls a funeral reminder "the kind of mistake that ends a
 * customer relationship permanently", and the way that mistake actually
 * happens is somebody adding a chip and nobody remembering this file exists.
 */

const TODAY = "2026-08-05";

function fact(over: Partial<OrderFact> = {}): OrderFact {
  return {
    orderId: "o1",
    customerId: "c1",
    customerName: "Andre",
    phone: "+263715550184",
    marketingConsent: true,
    deliveryDate: "2025-08-14",
    occasion: "birthday",
    itemName: "Chocolate cake",
    leadTimeHours: null,
    ...over,
  };
}

describe("which occasions recur", () => {
  test("ACCEPTANCE: every one of the seven chips, named individually", () => {
    // Exhaustive by construction: the Record type below fails to compile if a
    // chip is added to the union and not classified here. A loop over
    // Object.keys would not — it would happily pass with a new chip missing.
    const expected: Record<Occasion, boolean> = {
      birthday: true,
      anniversary: true,
      // A wedding does not recur. Nobody marries annually, and the couple's
      // anniversary is a different chip she would tag next year.
      wedding: false,
      funeral: false,
      // Sometimes an annual fixture, sometimes a one-off christening or a
      // product launch. A chip cannot tell Sous which.
      church: false,
      corporate: false,
      justBecause: false,
    };
    for (const [occasion, shouldRecur] of Object.entries(expected)) {
      expect(recurs(occasion as Occasion), `${occasion} recurrence`).toBe(shouldRecur);
    }
    expect([...RECURRING].sort()).toEqual(["anniversary", "birthday"]);
  });

  test("ACCEPTANCE: a funeral never generates a reminder", () => {
    // On its own, because this is the one the scope singles out. Same date,
    // same consent, same everything — only the chip differs.
    const anniversaryOf = { deliveryDate: "2025-08-08", leadTimeHours: null };
    expect(
      dueReminders([fact({ ...anniversaryOf, occasion: "birthday" })], TODAY),
    ).toHaveLength(1);
    expect(
      dueReminders([fact({ ...anniversaryOf, occasion: "funeral" })], TODAY),
    ).toHaveLength(0);
  });

  test("ACCEPTANCE: no non-recurring chip generates a reminder", () => {
    const nonRecurring: Occasion[] = [
      "wedding",
      "funeral",
      "church",
      "corporate",
      "justBecause",
    ];
    for (const occasion of nonRecurring) {
      expect(
        dueReminders([fact({ deliveryDate: "2025-08-08", occasion })], TODAY),
        `${occasion} must be silent`,
      ).toHaveLength(0);
    }
  });

  test("an order with no chip at all is silent", () => {
    // She did not say what it was for, so Sous does not guess.
    expect(dueReminders([fact({ occasion: null })], TODAY)).toHaveLength(0);
    expect(recurs(null)).toBe(false);
  });

  test("every chip has a label, in her words", () => {
    expect(Object.keys(OCCASION_LABEL).sort()).toEqual(
      ["anniversary", "birthday", "church", "corporate", "funeral", "justBecause", "wedding"],
    );
    expect(OCCASION_LABEL.justBecause).toBe("Just because");
  });
});

describe("when it comes round again", () => {
  test("later this year stays this year; earlier rolls to next", () => {
    expect(nextAnniversary("2025-08-14", TODAY)).toBe("2026-08-14");
    // 1 August has already gone by 5 August.
    expect(nextAnniversary("2025-08-01", TODAY)).toBe("2027-08-01");
  });

  test("today itself counts as due, not as missed", () => {
    expect(nextAnniversary("2024-08-05", TODAY)).toBe("2026-08-05");
  });

  test("it crosses a year boundary", () => {
    expect(nextAnniversary("2024-01-10", "2026-12-20")).toBe("2027-01-10");
    expect(nextAnniversary("2024-12-31", "2026-12-20")).toBe("2026-12-31");
  });

  test("29 February clamps to the 28th in a non-leap year", () => {
    // Three years in four a leap-day order has no anniversary. Dropping it
    // would mean that customer never hears from her again.
    expect(nextAnniversary("2024-02-29", "2026-01-01")).toBe("2026-02-28");
    // And in a leap year it lands on the real date.
    expect(nextAnniversary("2024-02-29", "2028-01-01")).toBe("2028-02-29");
  });

  test("a 31st clamps in the short months", () => {
    expect(nextAnniversary("2025-01-31", "2026-04-01")).toBe("2027-01-31");
    expect(nextAnniversary("2025-03-31", "2026-04-15")).toBe("2027-03-31");
  });
});

describe("how far ahead it surfaces", () => {
  test("no lead time floors at a week to decide", () => {
    expect(DECISION_DAYS).toBe(7);
    expect(reminderLeadDays(null)).toBe(7);
    expect(reminderLeadDays(0)).toBe(7);
  });

  test("the item's own lead time is added on top", () => {
    expect(reminderLeadDays(24 * 7)).toBe(14); // 7-day item → a fortnight out
    expect(reminderLeadDays(24 * 14)).toBe(21); // wedding cake → three weeks
  });

  test("part of a day rounds up, so it is never too late", () => {
    expect(reminderLeadDays(1)).toBe(8);
  });

  test("a reminder outside its window does not show yet", () => {
    // Birthday on 14 August, cupcakes, so the window opens 7 days out.
    const history = [fact({ deliveryDate: "2025-08-14" })];
    expect(dueReminders(history, "2026-08-06")).toHaveLength(0); // 8 days
    expect(dueReminders(history, "2026-08-07")).toHaveLength(1); // 7 days
  });

  test("a long-lead item surfaces earlier than a short-lead one", () => {
    const on = (leadTimeHours: number | null, today: string) =>
      dueReminders([fact({ deliveryDate: "2025-08-14", leadTimeHours })], today).length;
    // 21 days out: only the wedding cake is showing.
    expect(on(24 * 14, "2026-07-24")).toBe(1);
    expect(on(null, "2026-07-24")).toBe(0);
  });
});

describe("the three gates", () => {
  test("ACCEPTANCE: no consent, no reminder — whatever else is true", () => {
    const base = { deliveryDate: "2025-08-08", occasion: "birthday" as const };
    expect(dueReminders([fact({ ...base, marketingConsent: true })], TODAY)).toHaveLength(1);
    expect(dueReminders([fact({ ...base, marketingConsent: false })], TODAY)).toHaveLength(0);
  });

  test("a customer who has already been back is not chased", () => {
    // Andre's birthday order last August, and he ordered again last week.
    // She has him; reminding her to reach out is noise.
    const history = [
      fact({ orderId: "o1", deliveryDate: "2025-08-08", occasion: "birthday" }),
      fact({ orderId: "o2", deliveryDate: "2026-08-01", occasion: null }),
    ];
    expect(dueReminders(history, TODAY)).toHaveLength(0);
  });

  test("an order from BEFORE the window opened does not count as being back", () => {
    // He ordered in March. That is not the same as coming back for the
    // birthday, so the reminder still stands.
    const history = [
      fact({ orderId: "o1", deliveryDate: "2025-08-08", occasion: "birthday" }),
      fact({ orderId: "o2", deliveryDate: "2026-03-02", occasion: null }),
    ];
    expect(dueReminders(history, TODAY)).toHaveLength(1);
  });

  test("a dismissed reminder stays dismissed for that year only", () => {
    const history = [fact({ deliveryDate: "2025-08-08" })];
    const [reminder] = dueReminders(history, TODAY);
    expect(reminder.key).toBe(reminderKey("o1", "2026-08-08"));

    expect(dueReminders(history, TODAY, new Set([reminder.key]))).toHaveLength(0);
    // Next year is a different key, so "not this year" means this year.
    expect(dueReminders(history, "2027-08-05", new Set([reminder.key]))).toHaveLength(1);
  });

  test("the reminder carries what she needs to write the message", () => {
    const [r] = dueReminders([fact({ deliveryDate: "2025-08-08" })], TODAY);
    expect(r.customerName).toBe("Andre");
    expect(r.phone).toBe("+263715550184");
    expect(r.itemName).toBe("Chocolate cake");
    expect(r.lastOrderedOn).toBe("2025-08-08");
    expect(r.dueOn).toBe("2026-08-08");
    expect(r.daysAway).toBe(3);
  });

  test("soonest first, then by name", () => {
    const rows = dueReminders(
      [
        fact({ orderId: "a", customerId: "c1", customerName: "Zanele", deliveryDate: "2025-08-10" }),
        fact({ orderId: "b", customerId: "c2", customerName: "Andre", deliveryDate: "2025-08-07" }),
        fact({ orderId: "c", customerId: "c3", customerName: "Betty", deliveryDate: "2025-08-07" }),
      ],
      TODAY,
    );
    expect(rows.map((r) => r.customerName)).toEqual(["Andre", "Betty", "Zanele"]);
  });

  test("nothing at all is an empty list, not a crash", () => {
    expect(dueReminders([], TODAY)).toEqual([]);
  });

  test("day arithmetic crosses months and years", () => {
    expect(daysBetween("2026-08-05", "2026-08-08")).toBe(3);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });
});

describe("repeat versus first-time", () => {
  const order = (id: string, customerId: string | null) => ({ id, customerId });
  const revenue = () => 100;

  test("ACCEPTANCE: judged per order, against ALL history", () => {
    // Andre's first order was in 2024, outside this window. His order in the
    // window is a RETURN, which is what the word means.
    const inWindow = [order("o7", "andre"), order("o8", "chipo")];
    const firstEver = new Set(["o1", "o8"]); // o1 is Andre's first, outside
    const split = repeatSplit(inWindow, firstEver, revenue);
    expect(split.repeatCents).toBe(100);
    expect(split.firstTimeCents).toBe(100);
    expect(split.repeatPercent).toBe(50);
  });

  test("a customer's very first order is NOT retroactively repeat", () => {
    // The per-customer reading would relabel o1 the moment Andre came back,
    // which makes the figure drift one way forever.
    const orders = [order("o1", "andre"), order("o2", "andre")];
    const split = repeatSplit(orders, new Set(["o1"]), revenue);
    expect(split.firstTimeOrders).toBe(1);
    expect(split.repeatOrders).toBe(1);
    expect(split.repeatPercent).toBe(50);
  });

  test("a walk-in is never a return visit", () => {
    // Sous genuinely does not know whether that person has been in before,
    // and counting counter sales as repeat would be inventing a relationship.
    const split = repeatSplit([order("q1", null)], new Set(), revenue);
    expect(split.firstTimeOrders).toBe(1);
    expect(split.repeatOrders).toBe(0);
  });

  test("no revenue is null, never 0%", () => {
    // "0% repeat" is a claim about a business that has not traded yet.
    expect(repeatSplit([], new Set(), revenue).repeatPercent).toBeNull();
    expect(repeatSplit([order("o1", "a")], new Set(["o1"]), () => 0).repeatPercent).toBeNull();
  });
});

describe("occasion mix", () => {
  const order = (id: string, occasion: Occasion | null) => ({
    id,
    customerId: "c1",
    occasion,
  });

  test("counted by chip, busiest first", () => {
    const rows = occasionMix(
      [
        order("a", "birthday"),
        order("b", "birthday"),
        order("c", "wedding"),
        order("d", "funeral"),
      ],
      () => 1_000,
    );
    expect(rows.map((r) => r.occasion)).toEqual(["birthday", "funeral", "wedding"]);
    expect(rows[0]).toEqual({ occasion: "birthday", orders: 2, revenueCents: 2_000 });
  });

  test("orders with no chip are EXCLUDED, not bucketed as other", () => {
    // An "other" row built from missing data would be the biggest bar on the
    // chart and would mean nothing.
    const rows = occasionMix([order("a", "birthday"), order("b", null)], () => 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].orders).toBe(1);
  });

  test("every chip can appear, including the ones that never remind", () => {
    // The mix is about where her business comes from; recurrence is only
    // about who to message. A funeral is real revenue.
    const rows = occasionMix([order("a", "funeral")], () => 5_000);
    expect(rows[0].occasion).toBe("funeral");
    expect(rows[0].revenueCents).toBe(5_000);
  });

  test("nothing chipped is an empty list", () => {
    expect(occasionMix([], () => 0)).toEqual([]);
  });
});
