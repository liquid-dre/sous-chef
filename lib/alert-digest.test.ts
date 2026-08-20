// @vitest-environment node
import { describe, expect, test } from "vitest";
import { composeDigest, digestHeadline, type DigestInput } from "./alert-digest";

/**
 * The words in the one email a day.
 *
 * The subject is the whole thing: she reads it on a lock screen before she
 * goes shopping, and it has to name what she must buy. "3 alerts" is a count,
 * not an instruction, and this suite exists mostly to stop that sentence ever
 * being written.
 */

const base: DigestInput = {
  kitchenName: "Kitchen A",
  today: "2026-08-05",
  horizonEnd: "2026-08-11",
  orderCount: 3,
  demandBatches: 4,
  trust: "trusted",
  daysSinceCount: 0,
  alerts: [],
};

const alert = (name: string, severity: "red" | "amber" = "red") => ({
  name,
  severity,
  shortfall: "800 g",
  onHand: "200 g",
  booked: "1 kg",
  daysOfCover: 1,
});

describe("the subject line", () => {
  test("names what she has to buy, never a count", () => {
    const subject = digestHeadline({ ...base, alerts: [alert("Milk")] });
    expect(subject).toBe("Kitchen A: short of milk");
    expect(subject).not.toMatch(/\d+ alert/);
  });

  test("lists two and three ingredients readably", () => {
    expect(digestHeadline({ ...base, alerts: [alert("Milk"), alert("Flour")] })).toBe(
      "Kitchen A: short of milk and flour",
    );
    expect(
      digestHeadline({
        ...base,
        alerts: [alert("Milk"), alert("Flour"), alert("Butter")],
      }),
    ).toBe("Kitchen A: short of milk, flour and butter");
  });

  test("amber reads as running low, not as short", () => {
    expect(digestHeadline({ ...base, alerts: [alert("Milk", "amber")] })).toBe(
      "Kitchen A: running low on milk",
    );
  });

  test("red outranks amber in the subject", () => {
    // She acts on the thing she cannot cover; the amber is in the body.
    expect(
      digestHeadline({
        ...base,
        alerts: [alert("Sugar", "amber"), alert("Milk", "red")],
      }),
    ).toBe("Kitchen A: short of milk");
  });

  test("nothing wrong is a real outcome and says so", () => {
    expect(digestHeadline(base)).toBe("Kitchen A: nothing to buy this week");
  });

  test("a dormant pantry asks for the one thing that fixes it", () => {
    expect(digestHeadline({ ...base, trust: "dormant" })).toBe(
      "Kitchen A: take a stocktake",
    );
  });
});

describe("the body", () => {
  test("the demand half is stated flat, whatever the pantry is worth", () => {
    for (const trust of ["trusted", "hedged"] as const) {
      const { text } = composeDigest({ ...base, trust, alerts: [alert("Milk")] });
      expect(text).toContain("3 orders before 2026-08-11 need 4 batches.");
    }
  });

  test("only the supply half carries an age", () => {
    const { text } = composeDigest({
      ...base,
      trust: "hedged",
      daysSinceCount: 11,
      alerts: [alert("Milk")],
    });
    expect(text).toContain("11 days of arithmetic since anything was counted");
    // The demand sentence itself is untouched by the hedge.
    expect(text).toContain("3 orders before 2026-08-11 need 4 batches.");
  });

  test("never counted reads differently from gone out of date", () => {
    const { text } = composeDigest({
      ...base,
      trust: "hedged",
      daysSinceCount: null,
      alerts: [alert("Milk")],
    });
    expect(text).toContain("Nothing has been counted yet");
    expect(text).not.toContain("days of arithmetic");
  });

  test("dormant lists no ingredients at all", () => {
    const { text } = composeDigest({
      ...base,
      trust: "dormant",
      alerts: [alert("Milk"), alert("Flour")],
    });
    expect(text).not.toContain("Milk");
    expect(text).toContain("Two stocktakes have been missed");
  });

  test("an all-clear says so rather than sending an empty page", () => {
    const { text } = composeDigest(base);
    expect(text).toContain("Everything they need is covered.");
  });

  test("the HTML escapes a kitchen name that looks like markup", () => {
    const { html } = composeDigest({
      ...base,
      kitchenName: 'Rutendo <script>alert("x")</script>',
      orderCount: 0,
    });
    expect(html).not.toContain("<script>");
  });

  test("text and html carry the same sentences", () => {
    const input = { ...base, alerts: [alert("Milk")] };
    const { text, html } = composeDigest(input);
    for (const line of text.split("\n").filter(Boolean)) {
      expect(html).toContain(line.replace(/&/g, "&amp;"));
    }
  });
});
