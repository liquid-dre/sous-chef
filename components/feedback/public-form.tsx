"use client";

import * as React from "react";
import { CircleCheck } from "lucide-react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  FLAG_LABEL,
  type FeedbackFlag,
  type SensoryAxis,
} from "@/convex/lib/feedback";
import { cn } from "@/lib/utils";
import { DivergingScale } from "./diverging-scale";

/**
 * The customer's side. Under thirty seconds on a phone, on a bad connection.
 *
 * What it deliberately does NOT do: ask for a name, an email, a rating out of
 * five, or a moment of her customer's attention for anything Sous wants. There
 * is no login and no upsell. The whole page is one question asked once.
 *
 * Nothing is pre-selected — see components/feedback/diverging-scale.tsx. The
 * midpoint is where the control RESTS, not what it says; a pre-selected "just
 * right" would manufacture agreement from everyone who scrolled past, and the
 * readout counts people.
 *
 * Submits once. The button disables on the first tap and the mutation refuses
 * a second row for the order regardless, so a double-tap on a slow connection
 * cannot produce two answers from one person.
 */

const FLAGS: FeedbackFlag[] = ["lovedIt", "tooExpensive", "late", "packaging"];

export interface PublicFormItem {
  menuItemId: string;
  name: string;
  axes: SensoryAxis[];
}

export function PublicFeedbackForm({
  token,
  kitchenName,
  items,
}: {
  token: string;
  kitchenName: string;
  items: PublicFormItem[];
}) {
  const convex = useConvex();
  const [ratings, setRatings] = React.useState<Record<string, number | null>>({});
  const [flags, setFlags] = React.useState<FeedbackFlag[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const key = (menuItemId: string, axis: string) => `${menuItemId}:${axis}`;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await convex.mutation(api.feedback.submit, {
        token,
        perItem: items.map((item) => ({
          menuItemId: item.menuItemId as Id<"menuItems">,
          axisRatings: item.axes
            .map((axis) => ({ axis, value: ratings[key(item.menuItemId, axis)] }))
            .filter(
              (r): r is { axis: SensoryAxis; value: number } => r.value != null,
            ),
        })),
        flags,
        freeText: text.trim() || undefined,
      });
      if (result.ok || result.reason === "alreadySent") {
        setDone(true);
      } else if (result.reason === "empty") {
        setError("Tap something first — anything at all is useful.");
      } else {
        setError("This link isn't active any more.");
      }
    } catch {
      // A bad connection is the expected case, not the exception. Say what to
      // do rather than what went wrong.
      setError("That didn't go through. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <CircleCheck aria-hidden className="size-8 text-profit" strokeWidth={1.5} />
        <h2 className="type-display-sm">Thank you</h2>
        <p className="type-body max-w-xs text-pretty text-muted-foreground">
          {kitchenName} has your note. It goes straight to the kitchen — nobody
          else sees it.
        </p>
      </div>
    );
  }

  const empty =
    Object.values(ratings).every((v) => v == null) &&
    flags.length === 0 &&
    text.trim() === "";

  return (
    <div className="flex flex-col gap-8">
      {items.map((item) => (
        <section key={item.menuItemId} className="flex flex-col gap-5">
          <h2 className="type-title">{item.name}</h2>
          {item.axes.map((axis) => (
            <DivergingScale
              key={axis}
              axis={axis}
              value={ratings[key(item.menuItemId, axis)] ?? null}
              onChange={(value) =>
                setRatings((r) => ({ ...r, [key(item.menuItemId, axis)]: value }))
              }
              idPrefix={`${item.menuItemId}-`}
            />
          ))}
        </section>
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="type-title">Anything else?</h2>
        <ul className="flex flex-wrap gap-2">
          {FLAGS.map((flag) => {
            const on = flags.includes(flag);
            return (
              <li key={flag}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setFlags((f) => (on ? f.filter((x) => x !== flag) : [...f, flag]))
                  }
                  className={cn(
                    "min-h-11 rounded-full border px-4 type-label outline-none",
                    "transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] ease-out",
                    "focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
                    on
                      ? "border-primary bg-primary-soft text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {FLAG_LABEL[flag]}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <label htmlFor="feedback-words" className="type-title">
          In your own words
        </label>
        <Textarea
          id="feedback-words"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Optional"
        />
      </section>

      {error && (
        <p className="type-body text-loss" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button size="lg" disabled={busy || empty} onClick={submit}>
          {busy ? "Sending…" : "Send to the kitchen"}
        </Button>
        <p className="type-caption text-center text-muted-foreground">
          {empty
            ? "Tap anything above to send."
            : "You can send this once."}
        </p>
      </div>
    </div>
  );
}
