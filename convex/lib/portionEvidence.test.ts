// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  coverageNote,
  evidenceFor,
  reportFor,
  warningFor,
  type BatchFact,
  type PortionRating,
} from "./portionEvidence";

/**
 * The arithmetic behind "trays cut to 15 drew too small 4 times in 5".
 *
 * Two tests in this file matter more than the rest: that a rating nobody can
 * place is COUNTED rather than quietly dropped, and that the after-override
 * report has no units-sold figure at all. The first stops a denominator being
 * built from convenience; the second stops Sous making an elasticity claim it
 * has no business making.
 */

function batch(
  productionLogId: string,
  yieldUnits: number,
  orderIds: string[],
  producedAt = 0,
): BatchFact {
  return { productionLogId, orderIds, yieldUnits, batchCount: 1, producedAt };
}

function rating(orderId: string, value: number, receivedAt = 100): PortionRating {
  return { orderId, value, receivedAt };
}

describe("tracing a rating to the size it was about", () => {
  test("ACCEPTANCE: the yield the tray was cut at, from the batch that made it", () => {
    const batches = [
      batch("b15", 15, ["o1", "o2", "o3", "o4", "o5"]),
      batch("b12", 12, ["o6", "o7", "o8"]),
    ];
    const ratings = [
      // Four of the five at 15 called it small.
      rating("o1", -2), rating("o2", -1), rating("o3", -2), rating("o4", -1),
      rating("o5", 0),
      // One of three at 12.
      rating("o6", -1), rating("o7", 0), rating("o8", 1),
    ];

    const evidence = evidenceFor(ratings, batches);
    expect(evidence.byYield).toEqual([
      { yieldUnits: 12, saidTooSmall: 1, n: 3, sentence: "1 of 3 said it was too small." },
      { yieldUnits: 15, saidTooSmall: 4, n: 5, sentence: "4 of 5 said it was too small." },
    ]);
    expect(evidence.untraceable).toBe(0);
    expect(evidence.complainedYields).toEqual([12, 15]);
  });

  test("ACCEPTANCE: every claim carries its denominator", () => {
    const evidence = evidenceFor(
      [rating("o1", -2), rating("o2", -1), rating("o3", 0)],
      [batch("b", 15, ["o1", "o2", "o3"])],
    );
    // Never "2 people said too small" — the sample is what turns a count into
    // a claim, and DESIGN.md requires it beside every one.
    expect(evidence.byYield[0].sentence).toBe("2 of 3 said it was too small.");
    expect(evidence.byYield[0].n).toBe(3);
  });

  test("ACCEPTANCE: an order two batches claim is untraceable, never split", () => {
    const evidence = evidenceFor(
      [rating("o1", -2), rating("o2", -1)],
      [batch("b15", 15, ["o1", "o2"]), batch("b12", 12, ["o1"])],
    );
    // o1 could have come off either tray. That is an unknown, not a coin flip.
    expect(evidence.untraceable).toBe(1);
    expect(evidence.byYield).toEqual([
      { yieldUnits: 15, saidTooSmall: 1, n: 1, sentence: "1 of 1 said it was too small." },
    ]);
    expect(evidence.total).toBe(2);
  });

  test("ACCEPTANCE: an untraced rating is reported, not swallowed", () => {
    const evidence = evidenceFor(
      [rating("o1", -2), rating("o9", -2), rating("o9", -1)],
      [batch("b15", 15, ["o1"])],
    );
    expect(evidence.untraceable).toBe(2);
    expect(coverageNote(evidence)).toBe(
      "2 more ratings could not be traced to a batch, and are not in these figures.",
    );
    // Singular reads properly too — the sentence appears under every claim.
    expect(
      coverageNote(evidenceFor([rating("o9", -2)], [])),
    ).toBe("1 more rating could not be traced to a batch, and is not in these figures.");
    expect(coverageNote(evidenceFor([], []))).toBeNull();
  });

  test("a yield nobody complained about is never implicated", () => {
    const evidence = evidenceFor(
      [rating("o1", 0), rating("o2", 1)],
      [batch("b10", 10, ["o1", "o2"])],
    );
    expect(evidence.complainedYields).toEqual([]);
    expect(evidence.byYield[0].sentence).toBe("2 ratings, and nobody called it small.");
  });
});

describe("the warning", () => {
  const batches = [batch("b12", 12, ["o1", "o2", "o3"])];
  const ratings = [rating("o1", -2), rating("o2", -1), rating("o3", 0)];
  const evidence = evidenceFor(ratings, batches);

  test("ACCEPTANCE: no feedback means no warning at all, not an empty one", () => {
    // The 1.3 optimiser back, byte for byte. An empty shape would still render
    // a container and change the panel.
    expect(warningFor(evidenceFor([], []), 12, 15)).toBeNull();
  });

  test("it names the size, the sample, and that the suggestion cuts smaller", () => {
    const warning = warningFor(evidence, 12, 15)!;
    expect(warning.detail).toBe(
      "2 of 3 said 12 a tray was already too small, and 15 cuts it smaller.",
    );
    expect(warning.sampleSize).toBe(3);
    expect(warning.kind).toBe("portionTooSmall");
  });

  test("a COARSER suggestion is not something these ratings argue against", () => {
    // Cutting to 10 makes each piece bigger. "Too small" has nothing to say.
    const warning = warningFor(evidence, 12, 10)!;
    expect(warning.detail).toBe("2 of 3 said 12 a tray was already too small.");
    expect(warning.detail).not.toContain("cuts it smaller");
  });

  test("complaints at another size do not argue about this one", () => {
    const elsewhere = evidenceFor(
      [rating("o1", -2), rating("o2", -2)],
      [batch("b20", 20, ["o1", "o2"])],
    );
    expect(warningFor(elsewhere, 12, 15)).toBeNull();
  });

  test("ACCEPTANCE: an override silences this yield and only this yield", () => {
    expect(warningFor(evidence, 12, 15, [12])).toBeNull();
    // A different yield is a different decision, so the warning applies there.
    const at15 = evidenceFor(
      [rating("o4", -2), rating("o5", -1)],
      [batch("b15", 15, ["o4", "o5"])],
    );
    expect(warningFor(at15, 15, 18, [12])).not.toBeNull();
  });
});

describe("what Sous says afterwards", () => {
  const override = {
    yieldUnits: 15,
    decidedAt: 1_000,
    saidTooSmallAtDecision: 1,
    sampleAtDecision: 9,
    grossMarginPercentAtDecision: 54,
  };
  const batches = [batch("b15", 15, ["o1", "o2", "o3", "o4"])];

  test("ACCEPTANCE: the split is at the decision, not at the rating count", () => {
    const report = reportFor(
      [
        rating("o1", -2, 500), // before she decided
        rating("o2", -2, 2_000),
        rating("o3", -1, 3_000),
        rating("o4", 0, 4_000),
      ],
      batches,
      override,
      61,
    );
    // The one from before never lands in "since".
    expect(report.since).toEqual({
      saidTooSmall: 2,
      n: 3,
      grossMarginPercent: 61,
    });
    // "Before" is read off the stored row — what she was actually shown.
    expect(report.before).toEqual({
      saidTooSmall: 1,
      n: 9,
      grossMarginPercent: 54,
    });
  });

  test("ACCEPTANCE: there is no units-sold figure anywhere in the shape", () => {
    const report = reportFor([rating("o2", -2, 2_000)], batches, override, 61);

    // Asserted on the SHAPE first, so nobody can add volume back by editing a
    // sentence. "Orders fell after you cut finer" is an elasticity claim and
    // CONTEXT.md forbids it outright — the only two things Sous measures here
    // are complaints and margin.
    expect(Object.keys(report).sort()).toEqual([
      "before",
      "decidedAt",
      "sentences",
      "since",
      "yieldUnits",
    ]);
    for (const side of [report.before, report.since]) {
      expect(Object.keys(side).sort()).toEqual([
        "grossMarginPercent",
        "n",
        "saidTooSmall",
      ]);
    }

    // …and on the copy second. `yieldUnits` is the yield, not a volume, so the
    // word list names the risk precisely rather than banning "units".
    const serialised = JSON.stringify(report).toLowerCase();
    for (const forbidden of ["sold", "volume", "demand", "ordercount", "unitssold"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  test("it states both sides and names no cause", () => {
    const report = reportFor(
      [rating("o2", -2, 2_000), rating("o3", -1, 3_000), rating("o4", 0, 4_000)],
      batches,
      override,
      61,
    );
    expect(report.sentences).toEqual([
      "2 of 3 have said it was too small since, against 1 of 9 before.",
      "Gross margin is 61%, up from 54%.",
    ]);
    // No "because", no "so", no suggested yield. She draws the conclusion.
    const joined = report.sentences.join(" ").toLowerCase();
    for (const forbidden of ["because", "try ", "suggest", "instead", "should"]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  test("silence since the decision reads as silence, not as approval", () => {
    const report = reportFor([rating("o1", -2, 500)], batches, override, 54);
    expect(report.sentences[0]).toBe("Nobody has rated it at this size since.");
    expect(report.sentences[1]).toBe("Gross margin is still 54%.");
  });

  test("a margin that fell says so plainly", () => {
    const report = reportFor([], batches, override, 48);
    expect(report.sentences[1]).toBe("Gross margin is 48%, down from 54%.");
  });

  test("no price means no margin sentence rather than a zero", () => {
    const report = reportFor([], batches, override, null);
    expect(report.sentences).toHaveLength(1);
  });
});
