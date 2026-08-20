"use client";

import { MessageSquareHeart } from "lucide-react";
import {
  AXIS_LABEL,
  FLAG_LABEL,
  type FeedbackFlag,
  type Summary,
} from "@/convex/lib/feedback";
import { ProportionBar } from "./proportion-bar";
import { MIN_AXES_FOR_RADAR, SensoryRadar } from "./sensory-radar";

/**
 * What customers said about this item, on the menu-item page.
 *
 * The order is the argument: the shape first, then the distribution that
 * proves or disproves it, then who said it, then their own words. The
 * provenance line is not a footnote — it is the difference between eleven
 * people and one person remembering eleven times.
 */

export interface ReadoutData {
  axes: string[];
  summary: Summary;
  comments: {
    id: string;
    text: string;
    source: "chef" | "customer";
    receivedAt: number;
  }[];
}

export function ItemReadout({
  data,
  itemName,
}: {
  data: ReadoutData;
  itemName: string;
}) {
  const { summary } = data;

  if (data.axes.length === 0) {
    return (
      <Frame>
        <Empty
          title="Nothing to ask about yet"
          body={`Pick two to four things worth asking about ${itemName} — sweetness, moisture, portion size — and customers can rate them.`}
        />
      </Frame>
    );
  }

  if (summary.n === 0) {
    return (
      <Frame>
        <Empty
          title="Nobody has said yet"
          body="Log what a customer told you from the order, or share the feedback link with them. This becomes a shape you can read at a glance."
        />
      </Frame>
    );
  }

  const splitAxes = summary.axes.filter((a) => a.splitBothWays);
  const flags = (Object.keys(FLAG_LABEL) as FeedbackFlag[])
    .map((flag) => ({ flag, count: summary.flagCounts[flag] }))
    .filter((f) => f.count > 0);

  return (
    <Frame>
      {data.axes.length >= MIN_AXES_FOR_RADAR && (
        <SensoryRadar axes={summary.axes} n={summary.n} splitAxes={splitAxes} />
      )}

      <div className="flex flex-col gap-4">
        {summary.axes.map((axis) => (
          <ProportionBar key={axis.axis} summary={axis} />
        ))}
      </div>

      {/*
        Whose voices these are. Stated whenever any of them are hers — not only
        when most are — because she should never have to wonder which half she
        is looking at.
      */}
      {summary.provenance && (
        <p className="type-caption border-t pt-3 text-muted-foreground">
          {summary.provenance}
        </p>
      )}

      {flags.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {flags.map(({ flag, count }) => (
            <li
              key={flag}
              className="type-caption rounded-full border px-3 py-1 text-muted-foreground"
            >
              {FLAG_LABEL[flag]} ·{" "}
              <span className="numeric-sm text-foreground">{count}</span>
            </li>
          ))}
        </ul>
      )}

      {data.comments.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <h4 className="type-label text-muted-foreground">In their words</h4>
          <ul className="flex flex-col gap-2">
            {data.comments.map((comment) => (
              <li key={comment.id} className="flex flex-col gap-0.5">
                <p className="type-body text-pretty">
                  &ldquo;{comment.text}&rdquo;
                </p>
                <p className="type-caption text-muted-foreground">
                  {comment.source === "chef" ? "Your note" : "From the form"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="What customers said"
      className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:p-5"
    >
      <h3 className="type-title">What customers said</h3>
      {children}
    </section>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <MessageSquareHeart
        aria-hidden
        className="size-5 text-muted-foreground"
        strokeWidth={1.5}
      />
      <p className="type-body font-medium">{title}</p>
      <p className="type-caption max-w-64 text-pretty text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

/** Re-exported so the builder can label its picker with the same words. */
export { AXIS_LABEL };
