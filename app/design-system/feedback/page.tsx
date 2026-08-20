"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AxisPicker } from "@/components/feedback/axis-picker";
import { DivergingScale } from "@/components/feedback/diverging-scale";
import { ItemReadout } from "@/components/feedback/item-readout";
import { FeedbackSheet } from "@/components/feedback/feedback-sheet";
import { PublicFeedbackForm } from "@/components/feedback/public-form";
import {
  summarise,
  type FeedbackRow,
  type SensoryAxis,
} from "@/convex/lib/feedback";

/**
 * Feedback specimen — the grading surface for the scale everything else rests
 * on.
 *
 * Fixtures run through the REAL aggregation (convex/lib/feedback.ts is pure,
 * so it imports straight into the browser). Every count and every sentence on
 * this page is arithmetic, not a plausible-looking constant.
 *
 * Four shapes, because those are the ones that exist: an item with no axes
 * picked, an item with axes and nobody having answered, three responses (which
 * DESIGN.md says is not a trend and the chart has to say so itself), and
 * twenty-three — including one axis that is deliberately BIMODAL, which is the
 * case the whole diverging scale exists for and the case a mean destroys.
 */

const AXES: SensoryAxis[] = ["sweetness", "moisture", "richness", "portionSize"];

/** n rows, each rating one axis. */
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

type ShapeKey = "noAxes" | "noAnswers" | "three" | "many";

function rowsFor(shape: ShapeKey): FeedbackRow[] {
  if (shape === "noAxes" || shape === "noAnswers") return [];
  if (shape === "three") {
    return [
      ...rated("sweetness", [1, 2], "chef"),
      ...rated("moisture", [-1], "chef"),
    ];
  }
  return [
    // Sweetness: one-sided. Everyone who spoke said too sweet — a recipe
    // problem, and the radar's bulge is telling the truth.
    ...rated("sweetness", [2, 2, 1, 1, 2, 1, 1], "chef"),
    ...rated("sweetness", [1, 0], "customer"),
    // Moisture: dry, less emphatically.
    ...rated("moisture", [-1, -1, -2, -1], "chef"),
    // Richness: BIMODAL. Four say far too rich, four say far too plain. The
    // mean is exactly the midpoint, so the radar puts this axis ON the line
    // and reads as agreement. It is the opposite of agreement, and it is why
    // the proportion bar is not optional.
    ...rated("richness", [2, 2, 2, 2], "customer"),
    ...rated("richness", [-2, -2, -2, -2], "chef"),
    // Portion: small. This is what reaches the optimiser as a warning.
    ...rated("portionSize", [-1, -2, -1], "chef"),
    { source: "customer", axisRatings: [], flags: ["lovedIt"] },
    {
      source: "customer",
      axisRatings: [],
      flags: ["tooExpensive"],
      freeText: "Delicious but a bit steep for the size.",
    },
    {
      source: "chef",
      axisRatings: [],
      flags: [],
      freeText: "Said she'd order again for the church lunch.",
    },
  ];
}

const SHAPES = [
  { key: "noAxes", label: "No axes picked" },
  { key: "noAnswers", label: "Nobody yet" },
  { key: "three", label: "Three answers" },
  { key: "many", label: "Twenty-three" },
] as const;

export default function FeedbackSpecimenPage() {
  const [shape, setShape] = React.useState<ShapeKey>("many");
  const [picked, setPicked] = React.useState<SensoryAxis[]>(AXES);
  const [demo, setDemo] = React.useState<number | null>(null);

  const axes = React.useMemo<SensoryAxis[]>(
    () => (shape === "noAxes" ? [] : AXES),
    [shape],
  );
  const rows = React.useMemo(() => rowsFor(shape), [shape]);
  const summary = React.useMemo(() => summarise(axes, rows), [axes, rows]);
  const richness = summary.axes.find((a) => a.axis === "richness");

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Feedback specimen — real arithmetic, through convex/lib/feedback.ts
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Tabs value={shape} onValueChange={(v) => setShape(v as ShapeKey)}>
            <TabsList>
              {SHAPES.map((s) => (
                <TabsTrigger key={s.key} value={s.key}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 md:px-6 md:py-10">
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="type-display-sm">The diverging scale</h2>
            <p className="type-body max-w-prose text-muted-foreground">
              The hard component. Nothing is pre-selected — the midpoint is
              where the control RESTS, not what it says. Tap the chosen one
              again to clear it.
            </p>
          </div>
          <div className="max-w-sm rounded-lg border bg-card p-4">
            <DivergingScale axis="sweetness" value={demo} onChange={setDemo} />
            <p className="type-caption mt-2 text-muted-foreground">
              Value:{" "}
              <span className="numeric">{demo === null ? "null" : demo}</span> —
              null is what an untouched scale must send, not 0. The read-back
              line above stays empty until something is chosen; the unfilled
              dots already say nothing was.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="type-display-sm">Picking what to ask</h2>
            <p className="type-body max-w-prose text-muted-foreground">
              A fixed library of seven, two to four per item. Free text cannot
              aggregate, so the fixed list is the whole reason the feature
              works.
            </p>
          </div>
          <div className="max-w-2xl rounded-lg border bg-card p-4">
            <AxisPicker value={picked} onChange={setPicked} itemName="Brownies" />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="type-display-sm">Her one tap</h2>
            <p className="type-body max-w-prose text-muted-foreground">
              From the order row. Everything optional, a single remembered line
              is a complete entry.
            </p>
          </div>
          <FeedbackSheet
            customerName="Tariro"
            items={[{ menuItemId: "brownie", name: "Brownies", axes: AXES }]}
            onSave={async () => {}}
          />
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="type-display-sm">Her customer&rsquo;s side</h2>
            <p className="type-body max-w-prose text-muted-foreground">
              What lands at <span className="numeric">/f/[token]</span>. Under
              thirty seconds, no login, no email capture, and the word
              &ldquo;Sous&rdquo; nowhere on it — on the real route her palette
              is derived server-side so it is her colour before any JavaScript
              runs. The submit path is proved in convex/feedback.test.ts; this
              copy carries a fixture token, so sending does nothing.
            </p>
          </div>
          <div className="max-w-lg rounded-lg border bg-card p-4 md:p-6">
            <PublicFeedbackForm
              token="f_specimen"
              kitchenName="Rutendo's Kitchen"
              items={[{ menuItemId: "brownie", name: "Brownies", axes: AXES }]}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="type-display-sm">The readout</h2>
            <p className="type-body max-w-prose text-muted-foreground">
              On the menu item, in the same column as the costing and the
              optimiser.
            </p>
            {richness?.splitBothWays && (
              <p className="type-body max-w-prose text-loss">
                Richness is the case this page exists for: four said far too
                rich, four said far too plain. The mean is exactly{" "}
                <span className="numeric">{richness.meanRadarValue}</span>, so
                the radar sits it ON the midline. Only the proportion bar shows
                that nobody agreed.
              </p>
            )}
          </div>
          <div className="max-w-md">
            <ItemReadout
              itemName="Brownies"
              data={{
                axes,
                summary,
                comments: rows
                  .filter((r) => r.freeText)
                  .map((r, i) => ({
                    id: `c${i}`,
                    text: r.freeText!,
                    source: r.source,
                    receivedAt: 0,
                  })),
              }}
            />
          </div>
        </section>

        {/* The specimen's own check: if a mean ever starts standing in for a
            split, this line says so. */}
        <p className="type-caption text-muted-foreground">
          Bimodal axes detected:{" "}
          <span className="numeric">
            {summary.axes.filter((a) => a.splitBothWays).length}
          </span>{" "}
          · total responses <span className="numeric">{summary.n}</span> · of
          those, yours <span className="numeric">{summary.chefN}</span>
        </p>
      </main>
    </div>
  );
}
