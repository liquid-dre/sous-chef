// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  TOKENS,
  fillTokens,
  groupExclusions,
  partitionRecipients,
  reasonLabel,
  scheduleDueOn,
  scheduleKey,
  tokensIn,
  weekdayOf,
  type RecipientFacts,
} from "./messages";

/**
 * The rules that decide what leaves the building.
 *
 * The test that carries the slice asserts a consent-excluded contact is
 * absent from the sending list — not merely flagged in it, ABSENT — and
 * asserts it against the serialised payload too, so a future refactor that
 * "filters in the UI instead" fails here rather than in production. Consent
 * is the one gate in Sous with a statute behind it.
 */

const ANDRE: RecipientFacts = {
  customerId: "c1",
  name: "Andre Dingiswayo",
  phone: "+263715550184",
  email: "andre@example.com",
  marketingConsent: true,
  lastItemName: "Chocolate cake",
  balanceCents: 0,
};

function person(over: Partial<RecipientFacts> = {}): RecipientFacts {
  return { ...ANDRE, ...over };
}

describe("which tokens a body uses", () => {
  test("only what it actually asks for", () => {
    expect(tokensIn("Hi {name}, your {item} is ready.")).toEqual(["name", "item"]);
    expect(tokensIn("Taking orders for Wednesday.")).toEqual([]);
  });

  test("repeats collapse, and order is the declaration order", () => {
    expect(tokensIn("{item} {name} {item} {balance}")).toEqual([
      "name",
      "item",
      "balance",
    ]);
  });

  test("something that is not a token is left alone", () => {
    // A brace in her copy must not be mistaken for a field.
    expect(tokensIn("Open {9am} to {5pm}, {price} on request")).toEqual([]);
  });

  test("all four are recognised and nothing else is", () => {
    expect(TOKENS).toEqual(["name", "item", "date", "balance"]);
    expect(tokensIn("{name}{item}{date}{balance}")).toEqual([...TOKENS]);
  });
});

describe("filling one message", () => {
  test("every token resolves from the person, except the date", () => {
    const filled = fillTokens(
      "Hi {name}, your {item} for {date}. You owe {balance}.",
      person({ balanceCents: 4_000 }),
      "Wednesday",
    );
    expect(filled).toEqual({
      ok: true,
      text: "Hi Andre Dingiswayo, your Chocolate cake for Wednesday. You owe $40.00.",
    });
  });

  test("ACCEPTANCE: a balance of ZERO is a real value, not a hole", () => {
    // `0 || null` is null — the bug this test exists to prevent. "You owe
    // $0.00" is a sentence Sous can honestly write.
    const filled = fillTokens("You owe {balance}.", person({ balanceCents: 0 }), null);
    expect(filled).toEqual({ ok: true, text: "You owe $0.00." });
  });

  test("no past order means {item} cannot be filled", () => {
    const filled = fillTokens(
      "Hi {name}, your {item} is ready.",
      person({ lastItemName: null }),
      null,
    );
    expect(filled).toEqual({ ok: false, missing: ["item"] });
  });

  test("a body that never mentions {item} does not care that it is missing", () => {
    const filled = fillTokens("Hi {name}, taking orders.", person({ lastItemName: null }), null);
    expect(filled).toEqual({ ok: true, text: "Hi Andre Dingiswayo, taking orders." });
  });

  test("several holes are reported together, not one at a time", () => {
    const filled = fillTokens(
      "Hi {name}, your {item} for {date}.",
      person({ lastItemName: null }),
      null,
    );
    expect(filled).toEqual({ ok: false, missing: ["item", "date"] });
  });

  test("a blank name is a hole, not an empty greeting", () => {
    expect(fillTokens("Hi {name}.", person({ name: "  " }), null)).toEqual({
      ok: false,
      missing: ["name"],
    });
  });

  test("a repeated token fills every occurrence", () => {
    const filled = fillTokens("{name}, {name} — hello.", person({ name: "Rudo" }), null);
    expect(filled).toEqual({ ok: true, text: "Rudo, Rudo — hello." });
  });

  test("a negative balance is signed and parenthesis-free here", () => {
    // Overpayment. The UI renders money; this only has to be unambiguous.
    const filled = fillTokens("{balance}", person({ balanceCents: -1_250 }), null);
    expect(filled).toEqual({ ok: true, text: "−$12.50" });
  });
});

describe("who the message goes to", () => {
  test("ACCEPTANCE: a consent-excluded contact never reaches the sending list", () => {
    const { sending, excluded } = partitionRecipients(
      [
        person({ customerId: "c1", name: "Andre" }),
        person({ customerId: "c2", name: "Chipo", marketingConsent: false }),
      ],
      "Hi {name}.",
      "whatsapp",
      null,
    );

    expect(sending.map((s) => s.customerId)).toEqual(["c1"]);
    // Absent, not present-and-flagged. Asserted on the serialised payload as
    // well, so a refactor that returns everybody and filters in the UI fails
    // here rather than quietly shipping.
    const serialised = JSON.stringify(sending);
    expect(serialised).not.toContain("c2");
    expect(serialised).not.toContain("Chipo");

    expect(excluded).toHaveLength(1);
    expect(excluded[0].reason).toEqual({ kind: "optedOut" });
  });

  test("consent is checked before anything else can save them", () => {
    // Opted out AND unreachable AND unfillable: the reason she sees is the
    // one that matters, and it is never "no phone number".
    const { excluded } = partitionRecipients(
      [person({ marketingConsent: false, phone: null, lastItemName: null })],
      "Hi {name}, your {item}.",
      "whatsapp",
      null,
    );
    expect(excluded[0].reason).toEqual({ kind: "optedOut" });
  });

  test("the channel decides what counts as reachable", () => {
    const noPhone = person({ customerId: "c1", phone: null });
    const noEmail = person({ customerId: "c2", email: null });

    const wa = partitionRecipients([noPhone, noEmail], "Hi {name}.", "whatsapp", null);
    expect(wa.sending.map((s) => s.customerId)).toEqual(["c2"]);
    expect(wa.excluded[0].reason).toEqual({ kind: "noChannel", channel: "whatsapp" });

    const email = partitionRecipients([noPhone, noEmail], "Hi {name}.", "email", null);
    expect(email.sending.map((s) => s.customerId)).toEqual(["c1"]);
    expect(email.excluded[0].reason).toEqual({ kind: "noChannel", channel: "email" });
  });

  test("ACCEPTANCE: an unfillable token excludes that recipient with the reason", () => {
    const { sending, excluded } = partitionRecipients(
      [
        person({ customerId: "c1", name: "Andre" }),
        person({ customerId: "c2", name: "Chipo", lastItemName: null }),
      ],
      "Hi {name}, your {item} is ready.",
      "whatsapp",
      null,
    );
    expect(sending).toHaveLength(1);
    expect(excluded[0].reason).toEqual({ kind: "unfillable", tokens: ["item"] });
    // And the message that DOES go is a whole sentence.
    expect(sending[0].body).toBe("Hi Andre, your Chocolate cake is ready.");
  });

  test("a body with no tokens excludes nobody for lacking data", () => {
    const { sending, excluded } = partitionRecipients(
      [person({ lastItemName: null, balanceCents: 0 })],
      "Taking orders for Wednesday — let me know.",
      "whatsapp",
      null,
    );
    expect(sending).toHaveLength(1);
    expect(excluded).toHaveLength(0);
  });

  test("the sending list carries the address for this channel", () => {
    const wa = partitionRecipients([person()], "Hi {name}.", "whatsapp", null);
    expect(wa.sending[0].to).toBe("+263715550184");
    const email = partitionRecipients([person()], "Hi {name}.", "email", null);
    expect(email.sending[0].to).toBe("andre@example.com");
  });

  test("both lists come back by name, so the order does not wobble", () => {
    const { sending } = partitionRecipients(
      [
        person({ customerId: "c1", name: "Zanele" }),
        person({ customerId: "c2", name: "Andre" }),
        person({ customerId: "c3", name: "Betty" }),
      ],
      "Hi {name}.",
      "whatsapp",
      null,
    );
    expect(sending.map((s) => s.name)).toEqual(["Andre", "Betty", "Zanele"]);
  });

  test("nobody at all is two empty lists, not a crash", () => {
    expect(partitionRecipients([], "Hi {name}.", "whatsapp", null)).toEqual({
      sending: [],
      excluded: [],
    });
  });
});

describe("the exclusion panel", () => {
  test("reasons read as sentences she can act on", () => {
    expect(reasonLabel({ kind: "optedOut" })).toBe("opted out of marketing");
    expect(reasonLabel({ kind: "noChannel", channel: "whatsapp" })).toBe("no phone number");
    expect(reasonLabel({ kind: "noChannel", channel: "email" })).toBe("no email address");
    expect(reasonLabel({ kind: "unfillable", tokens: ["item"] })).toBe(
      "nothing to fill {item}",
    );
    expect(reasonLabel({ kind: "unfillable", tokens: ["item", "date"] })).toBe(
      "nothing to fill {item} and {date}",
    );
  });

  test("grouped by reason, biggest first — not forty lines to tally", () => {
    const { excluded } = partitionRecipients(
      [
        person({ customerId: "a", name: "A", marketingConsent: false }),
        person({ customerId: "b", name: "B", marketingConsent: false }),
        person({ customerId: "c", name: "C", marketingConsent: false }),
        person({ customerId: "d", name: "D", phone: null }),
      ],
      "Hi {name}.",
      "whatsapp",
      null,
    );
    const groups = groupExclusions(excluded);
    expect(groups).toEqual([
      { label: "opted out of marketing", names: ["A", "B", "C"] },
      { label: "no phone number", names: ["D"] },
    ]);
  });

  test("nothing excluded is an empty list", () => {
    expect(groupExclusions([])).toEqual([]);
  });
});

describe("recurring schedules", () => {
  // 2026-08-09 is a Sunday; 2026-08-10 a Monday.
  const SUNDAY = "2026-08-09";
  const schedule = { id: "s1", weekday: 0, active: true };

  test("due on the weekday, and not on the day after", () => {
    expect(weekdayOf(SUNDAY)).toBe(0);
    expect(scheduleDueOn(schedule, SUNDAY, new Set())).toBe(true);
    expect(scheduleDueOn(schedule, "2026-08-10", new Set())).toBe(false);
    expect(scheduleDueOn(schedule, "2026-08-08", new Set())).toBe(false);
  });

  test("an inactive schedule is never due", () => {
    expect(scheduleDueOn({ ...schedule, active: false }, SUNDAY, new Set())).toBe(false);
  });

  test("already answered suppresses it — for that day only", () => {
    const key = scheduleKey("s1", SUNDAY);
    expect(key).toBe("s1:2026-08-09");
    expect(scheduleDueOn(schedule, SUNDAY, new Set([key]))).toBe(false);
    // The next Sunday is a different key, so it comes round again.
    expect(scheduleDueOn(schedule, "2026-08-16", new Set([key]))).toBe(true);
  });

  test("two schedules on the same day do not answer for each other", () => {
    const answered = new Set([scheduleKey("s1", SUNDAY)]);
    expect(scheduleDueOn({ id: "s2", weekday: 0, active: true }, SUNDAY, answered)).toBe(
      true,
    );
  });

  test("weekdays are Sunday-zero, matching orgs.stocktakeDay", () => {
    expect(weekdayOf("2026-08-09")).toBe(0); // Sunday
    expect(weekdayOf("2026-08-12")).toBe(3); // Wednesday
    // And it survives a month and a year boundary.
    expect(weekdayOf("2026-09-01")).toBe(2);
    expect(weekdayOf("2027-01-01")).toBe(5);
  });
});
