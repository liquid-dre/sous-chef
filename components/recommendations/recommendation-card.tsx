"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoneyExact } from "@/components/charts-sous/format";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

/**
 * One subject, one figure, every reason underneath it.
 *
 * The shape is the argument. The money is the biggest thing on the card
 * because the list is ranked by it; the KIND of money sits right under it
 * because "$41" alone invites her to add it to a number it cannot be added
 * to; the sentence is in her words; the arithmetic is one tap away and closed
 * by default, because she came here to act, not to audit.
 *
 * It FLAGS, it does not instruct (CONTEXT.md). The action button is the one
 * imperative on the card, and it names a mechanism — "Re-cost it", "Change the
 * batch size" — rather than a business decision.
 */

/** Numbers under ten read as words in a sentence; the money is the only thing
 * on this card that should look like a figure. */
const COUNT: Record<number, string> = {
  2: "two",
  3: "three",
  4: "four",
  5: "five",
};

export interface CardCause {
  kind: string;
  cents: number;
  sentence: string;
  workings: string;
}

export interface CardRow {
  subjectKey: string;
  subjectName: string;
  cents: number;
  kindLabel: string;
  headline: string;
  causes: CardCause[];
  action: { kind: string; label: string; href: string; targetId: string | null };
  window: string | null;
  trend: { label: string; points: { date: string; value: number }[] } | null;
}

export function RecommendationCard({
  row,
  rank,
  onAct,
  onDismiss,
  onRestore,
  busy,
  leaving,
}: {
  row: CardRow;
  /** 1-based. The top card is the one Home calls "the biggest thing". */
  rank?: number;
  /** Present only for the in-place actions; navigation uses the link. */
  onAct?: () => void;
  onDismiss?: () => void;
  onRestore?: () => void;
  busy?: boolean;
  /** Set for the 200ms between her tapping "Not now" and the row leaving. */
  leaving?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const isTop = rank === 1;

  /**
   * When one cause carries all the money, its sentence IS the card and the
   * figure above it needs no explaining.
   *
   * When two or more do, leading with the biggest one's sentence puts "$25.44
   * of Brownies was baked and never sold" directly under a $50.24 heading —
   * two true numbers that look like a contradiction. The browser showed
   * exactly that. So a multi-cause card drops the headline and lists every
   * cause with its amount instead, and the list visibly adds up to the figure.
   */
  const moneyCauses = row.causes.filter((c) => c.cents > 0);
  const single = moneyCauses.length <= 1;
  const evidence = single ? row.causes.slice(1) : row.causes;

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5",
        // Named properties, never `transition: all` — and only transform and
        // opacity, which skip layout and paint.
        "transition-[opacity,transform] duration-[var(--duration-base)] ease-out",
        // The top row is the one Home already told her about. A ring rather
        // than a different background: it marks the row without making the
        // others look disabled.
        isTop && "ring-1 ring-loss/30",
        onRestore && "opacity-70",
        // Setting a card aside is a decision, and a row that simply blinks out
        // when the query updates reads as a glitch. It leaves in the direction
        // it is going.
        leaving && "pointer-events-none -translate-y-1 opacity-0",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* Wraps rather than truncates. A chart axis has no room and must
              ellipsise, but a card title does — and "Orders unde…" as the
              heading of the thing she is deciding about is worse than two
              lines. */}
          <h3 className="type-title min-w-0 text-balance">{row.subjectName}</h3>
          <p className="type-caption text-muted-foreground">
            {row.window ?? (isTop ? "The biggest thing hurting it" : "This period")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="numeric-lg text-loss">{formatMoneyExact(row.cents)}</span>
          {/* Which KIND of dollar this is. Without it the ranking would put a
              loss and a might-have-been side by side and call them equal.
              A card whose money is split between kinds says so instead of
              claiming the biggest one's label for the whole figure — $50.24
              is not all "never paid for" when half of it was never earned. */}
          <span className="type-caption text-right text-muted-foreground">
            {single ? row.kindLabel : `${COUNT[moneyCauses.length] ?? moneyCauses.length} things`}
          </span>
        </div>
      </div>

      {single && <p className="type-body-lg text-pretty">{row.headline}</p>}

      {row.trend && <Sparkline points={row.trend.points} label={row.trend.label} />}

      {evidence.length > 0 && (
        <ul className={cn("flex flex-col gap-1.5", single && "border-l-2 pl-3")}>
          {evidence.map((cause) => (
            <li key={cause.kind} className="flex items-baseline justify-between gap-3">
              <span
                className={cn(
                  "min-w-0",
                  single ? "type-body text-muted-foreground" : "type-body",
                )}
              >
                {cause.sentence}
              </span>
              {cause.cents > 0 && (
                <span className="numeric-sm shrink-0 text-muted-foreground">
                  {formatMoneyExact(cause.cents)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {onRestore ? (
          <Button variant="outline" size="sm" onClick={onRestore} disabled={busy}>
            <Undo2 aria-hidden /> Pick it back up
          </Button>
        ) : (
          <>
            {onAct ? (
              <Button size="sm" onClick={onAct} disabled={busy}>
                {row.action.label}
              </Button>
            ) : (
              <Button size="sm" asChild>
                <Link href={row.action.href}>
                  {row.action.label}
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>
                Not now
              </Button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto min-h-9 rounded-sm px-2 type-label text-muted-foreground outline-none transition-[color,transform] duration-[var(--duration-fast)] ease-out hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
        >
          {open ? "Hide the arithmetic" : "Show the arithmetic"}
        </button>
      </div>

      {open && (
        <dl className="flex animate-in flex-col gap-2 rounded-md bg-muted/50 p-3 duration-[var(--duration-fast)] fade-in-0 slide-in-from-top-1 ease-out">
          {row.causes.map((cause) => (
            <div key={cause.kind} className="flex flex-col gap-0.5">
              {/* On a one-cause card the sentence is already the headline
                  three lines up, and repeating it makes the disclosure look
                  like it is padding. Only the arithmetic is new. */}
              {!single && (
                <dt className="type-label flex items-baseline justify-between gap-3">
                  <span className="min-w-0">{cause.sentence}</span>
                  {cause.cents > 0 && (
                    <span className="numeric-sm shrink-0">
                      {formatMoneyExact(cause.cents)}
                    </span>
                  )}
                </dt>
              )}
              <dd className="type-caption text-pretty text-muted-foreground">
                {cause.workings}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
