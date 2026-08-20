"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDateOnly, formatWeekday } from "@/lib/day";
import { DueCard, StartCard, StocktakeCard } from "./entry-card";
import type { CalendarDay } from "./types";

/**
 * One day, in full: what is due, what to start, what to buy.
 *
 * The three sections are in the order she can still change them. What to
 * start is the only one where a decision is still open this morning; what is
 * due is settled; what to buy is a shopping list for later.
 *
 * "What to buy" is OWNER-ONLY by construction rather than by a hidden flag —
 * `purchases.createBatch` is an `ownerMutation` and every pantry runway query
 * is an `ownerQuery`, so there is no staff-shaped version of it to render.
 * Passing `shortfalls` is how the owner path lights up; staff never receive
 * the prop because the payload does not carry it.
 */
export function DayDetail({
  day,
  orgSlug,
  canRecordStocktake,
  ceilingHours,
}: {
  day: CalendarDay;
  orgSlug: string;
  canRecordStocktake: boolean;
  /** Owner only — undefined for staff, and the capacity line then does not
   * render at all rather than rendering with a guessed ceiling. */
  ceilingHours?: number;
}) {
  const nothing =
    day.due.length === 0 && day.prompts.length === 0 && !day.isStocktake;

  return (
    <section
      aria-label={`What is on ${day.day}`}
      className="flex flex-col gap-4 rounded-lg border bg-card p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-title">
          {day.isToday ? "Today" : formatWeekday(day.day)}{" "}
          <span className="type-caption text-muted-foreground">
            {formatDateOnly(day.day)}
          </span>
        </h2>
        {day.capacity && ceilingHours !== undefined && (
          <p
            className={
              day.capacity.over
                ? "type-caption rounded-full bg-warn-soft px-2 py-0.5 text-warn-foreground"
                : "type-caption text-muted-foreground"
            }
          >
            <span className="numeric">{day.capacity.hours}</span> of{" "}
            <span className="numeric">{ceilingHours}</span> hours
            {day.capacity.over ? " — more than your day" : ""}
          </p>
        )}
      </header>

      {nothing ? (
        <p className="type-body text-muted-foreground">
          Nothing due and nothing to start.
        </p>
      ) : (
        <>
          {day.prompts.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="type-label text-muted-foreground">To start</h3>
              <ul className="flex flex-col gap-2">
                {day.prompts.map((p) => (
                  <StartCard key={p.menuItemId} prompt={p} orgSlug={orgSlug} />
                ))}
              </ul>
            </div>
          )}

          {day.isStocktake && (
            <ul className="flex flex-col gap-2">
              <StocktakeCard orgSlug={orgSlug} canRecord={canRecordStocktake} />
            </ul>
          )}

          {day.due.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="type-label text-muted-foreground">Due</h3>
              <ul className="flex flex-col gap-2">
                {day.due.map((d) => (
                  <DueCard key={d.orderId} entry={d} orgSlug={orgSlug} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* What to buy. Owner only — and rather than duplicating the pantry
          runway here, it points at the screen that already computes it
          honestly, with its own freshness and its own degradation rules. Two
          sources for "are you short of flour" is exactly how they drift
          apart. */}
      {ceilingHours !== undefined && day.prompts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="type-caption min-w-40 flex-1 text-muted-foreground">
            Baking this day draws on the pantry.
          </p>
          <Button variant="ghost" size="sm" className="min-h-11 md:min-h-9" asChild>
            <Link href={`/${orgSlug}/alerts`}>What to buy</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
