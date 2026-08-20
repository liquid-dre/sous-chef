// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  summarise,
  toRadarValue,
  warningsFor,
  type FeedbackRow,
  type SensoryAxis,
} from "./feedback";

/**
 * The arithmetic behind "7 of 11 said too sweet".
 *
 * One test in this file matters more than all the others: a scale whose two
 * ends cancel is worse than no feedback at all, because it reports agreement
 * where there is none. Everything else here is bookkeeping.
 */

/** n rows, each rating one axis at one value. */
function rated(
  axis: SensoryAxis,
  values: number[],
  source: "chef" | "customer" = "customer",
): FeedbackRow[] {
  return values.map((value) => ({
    source,
    axisRatings: [{ axis, value }],
    flags: [],
  }));
}

describe("the scale cannot collapse", () => {
  test("ACCEPTANCE: four saying far too sweet and four saying not sweet enough is not agreement", () => {
    const { axes } = summarise(
      ["sweetness"],
      rated("sweetness", [2, 2, 2, 2, -2, -2, -2, -2]),
    );
    const sweetness = axes[0];

    // The mean IS zero, and zero IS the midpoint. That is the whole trap: a
    // readout built on the mean alone would say "just right" to eight people
    // who all thought it was wrong.
    expect(sweetness.meanRadarValue).toBe(50);

    // So the mean never travels alone.
    expect(sweetness.counts).toEqual([4, 0, 0, 0, 4]);
    expect(sweetness.splitBothWays).toBe(true);
    expect(sweetness.sentence).toBe("4 of 8 said too sweet. 4 said not sweet enough.");
    // And in particular it does not claim anyone was happy.
    expect(sweetness.sentence).not.toContain("just right");
  });

  test("everyone agreeing is a different shape from everyone disagreeing", () => {
    const oneSided = summarise(["sweetness"], rated("sweetness", [1, 1, 2, 1])).axes[0];
    expect(oneSided.splitBothWays).toBe(false);
    expect(oneSided.sentence).toBe("4 of 4 said too sweet.");
    // Mean well above the midline — a recipe problem, and it reads as one.
    expect(oneSided.meanRadarValue).toBeGreaterThan(50);

    const split = summarise(["sweetness"], rated("sweetness", [2, 2, -2, -1])).axes[0];
    expect(split.splitBothWays).toBe(true);
    // Same axis, similar n, and the two summaries share no wording.
    expect(split.sentence).toBe("2 of 4 said too sweet. 2 said not sweet enough.");
  });

  test("each axis names its own directions, not 'too much' and 'too little'", () => {
    const rows = [
      ...rated("moisture", [-2, -1]),
      ...rated("doneness", [2]),
      ...rated("portionSize", [-1]),
    ];
    const { axes } = summarise(["moisture", "doneness", "portionSize"], rows);
    expect(axes[0].sentence).toBe("2 of 2 said too dry.");
    expect(axes[1].sentence).toBe("1 of 1 said overdone.");
    expect(axes[2].sentence).toBe("1 of 1 said too small.");
  });
});

describe("counts and denominators", () => {
  test("values land in their own buckets, low to high", () => {
    const { axes } = summarise(
      ["heat"],
      rated("heat", [-2, -1, -1, 0, 1, 1, 1, 2]),
    );
    expect(axes[0].counts).toEqual([1, 2, 1, 3, 1]);
    expect(axes[0].n).toBe(8);
  });

  test("ACCEPTANCE: her notes and the form share one count, and the split is stated", () => {
    const rows = [
      ...rated("sweetness", [1, 1, 2, 1, 2, 1, 1, 2, 1], "chef"),
      ...rated("sweetness", [1, 0], "customer"),
    ];
    const summary = summarise(["sweetness"], rows);
    expect(summary.n).toBe(11);
    expect(summary.chefN).toBe(9);
    expect(summary.provenance).toBe(
      "9 of the 11 are your notes; 2 came from the form.",
    );
  });

  test("all-hers and all-theirs each say so plainly", () => {
    expect(summarise(["sweetness"], rated("sweetness", [1, 1], "chef")).provenance).toBe(
      "All 2 are your own notes — nobody has used the form yet.",
    );
    expect(
      summarise(["sweetness"], rated("sweetness", [1, 1], "customer")).provenance,
    ).toBeNull();
    expect(summarise(["sweetness"], rated("sweetness", [1], "chef")).provenance).toBe(
      "That one is your own note.",
    );
  });

  test("nothing said is silence, not a zero", () => {
    const summary = summarise(["sweetness", "moisture"], []);
    expect(summary.n).toBe(0);
    expect(summary.provenance).toBeNull();
    expect(summary.axes[0].sentence).toBe("Nobody has said yet.");
    // An unrated axis sits ON the midline rather than collapsing the polygon
    // to the centre, which would draw a claim nobody made.
    expect(summary.axes[0].meanRadarValue).toBe(50);
  });

  test("a rating for an axis she has since removed is dropped, not resurrected", () => {
    const rows = [
      ...rated("saltiness", [2, 2]),
      ...rated("sweetness", [1]),
    ];
    const summary = summarise(["sweetness"], rows);
    expect(summary.axes.map((a) => a.axis)).toEqual(["sweetness"]);
    // Two rows said only saltiness — they contribute nothing to this item now.
    expect(summary.n).toBe(1);
  });

  test("a flag with no rating still counts as somebody having spoken", () => {
    const summary = summarise(["sweetness"], [
      { source: "customer", axisRatings: [], flags: ["lovedIt"] },
    ]);
    expect(summary.n).toBe(1);
    expect(summary.flagCounts.lovedIt).toBe(1);
    // …but not toward the axis, which nobody rated.
    expect(summary.axes[0].n).toBe(0);
  });

  test("words alone count; an empty row does not", () => {
    // Her logging is usually a half-remembered comment with no rating at all,
    // and dropping those would undercount exactly the path CONTEXT.md calls
    // primary.
    const words = summarise(["sweetness"], [
      { source: "chef", axisRatings: [], flags: [], freeText: "Said it was lovely." },
    ]);
    expect(words.n).toBe(1);

    const nothing = summarise(["sweetness"], [
      { source: "chef", axisRatings: [], flags: [], freeText: "   " },
    ]);
    expect(nothing.n).toBe(0);
  });
});

describe("the radar mapping is a guard, not a convenience", () => {
  test("the five values map onto the chart's hard-coded 0..100", () => {
    expect(toRadarValue(-2)).toBe(0);
    expect(toRadarValue(-1)).toBe(25);
    expect(toRadarValue(0)).toBe(50);
    expect(toRadarValue(1)).toBe(75);
    expect(toRadarValue(2)).toBe(100);
  });

  test("no rating can produce a negative radius, which would render mirrored", () => {
    for (const value of [-2, -1, 0, 1, 2]) {
      expect(toRadarValue(value)).toBeGreaterThanOrEqual(0);
      expect(toRadarValue(value)).toBeLessThanOrEqual(100);
    }
    // And an out-of-range value never reaches the mapping at all — it is
    // dropped at the bucket, so a tampered −7 cannot draw anywhere.
    const { axes } = summarise(["heat"], rated("heat", [-7, 9, 1]));
    expect(axes[0].n).toBe(1);
    expect(axes[0].meanRadarValue).toBe(75);
  });
});

describe("the optimiser's warnings", () => {
  test("a price warning built from her own notes says so", () => {
    const rows: FeedbackRow[] = [
      { source: "chef", axisRatings: [], flags: ["tooExpensive"] },
      { source: "chef", axisRatings: [], flags: ["tooExpensive"] },
      // A note with no flag and no rating. Still somebody having spoken, and
      // still in the denominator — this is the shape her own logging usually
      // takes.
      { source: "chef", axisRatings: [], flags: [], freeText: "She was happy." },
    ];
    const [warning] = warningsFor(summarise([], rows));
    expect(warning.kind).toBe("tooExpensive");
    expect(warning.detail).toContain("2 of the last 3 said it was too expensive");
    // The loop this sentence exists to break: her own belief returning to her
    // as evidence for a price change.
    expect(warning.detail).toContain("all of them from your own notes");
  });

  test("a mixed sample states the shape rather than inventing an overlap", () => {
    const rows: FeedbackRow[] = [
      { source: "chef", axisRatings: [], flags: ["tooExpensive"] },
      { source: "customer", axisRatings: [], flags: ["tooExpensive"] },
      { source: "customer", axisRatings: [], flags: [], freeText: "Lovely." },
    ];
    const [warning] = warningsFor(summarise([], rows));
    expect(warning.detail).toContain("1 of your 3 entries are your own notes");
  });

  test("too small comes from the portion axis, counting both degrees", () => {
    const summary = summarise(["portionSize"], rated("portionSize", [-2, -1, -1, 0, 2]));
    const warning = warningsFor(summary).find((w) => w.kind === "portionTooSmall")!;
    expect(warning.detail).toContain("3 of the last 5 said it was too small");
    expect(warning.sampleSize).toBe(5);
  });

  test("nothing wrong warns about nothing", () => {
    expect(warningsFor(summarise(["portionSize"], rated("portionSize", [0, 0, 1])))).toEqual(
      [],
    );
    expect(warningsFor(summarise([], []))).toEqual([]);
  });
});
