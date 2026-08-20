"use client";

import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { formatDateOnly, formatWeekday } from "@/lib/day";
import { DueCard, StartCard, StocktakeCard } from "./entry-card";
import { isEmptyDay, type CalendarDay } from "./types";

/**
 * The mobile view: an agenda scrolling by day.
 *
 * DESIGN.md's design note for this slice is explicit — resist a full month
 * grid on mobile. A 7×5 grid at 375px gives cells about 50px wide, which is
 * under the 44px tap target once you subtract the gap, and each one can hold
 * about two characters. That is a picture of a month rather than a tool for
 * getting through Thursday. Someone checking what to make today wants a list.
 *
 * Empty days are DROPPED rather than rendered blank. A calendar that lists
 * "Tuesday — nothing" eleven times buries the three days that matter, and the
 * header already states the range so the gaps are not ambiguous.
 *
 * Sticky headers because the list is long and the question the whole screen
 * answers is "which day am I looking at". This is the first day-grouped list
 * in Sous; `orders-list.tsx` is a flat list with the date inline per row.
 */
export function AgendaList({
  days,
  orgSlug,
  canRecordStocktake,
  className,
}: {
  days: CalendarDay[];
  orgSlug: string;
  canRecordStocktake: boolean;
  className?: string;
}) {
  const withSomething = days.filter((d) => !isEmptyDay(d));

  if (withSomething.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing in these days"
        body="Orders land here on the day they are due, with a prompt a few days earlier telling you when to start baking."
        actionLabel="Take an order"
        actionHref={`/${orgSlug}/orders/new`}
      />
    );
  }

  return (
    <ol className={cn("flex flex-col", className)}>
      {withSomething.map((day) => (
        <li key={day.day} className="flex flex-col">
          {/* `top-14` clears the mobile top bar (app-shell.tsx:107, h-14).
              Under it the header would slide behind the chrome and the one
              thing the sticky header exists to say would be invisible. */}
          <h2
            className={cn(
              "sticky top-14 z-10 flex items-baseline gap-2 bg-background py-2 md:top-0",
              day.isPast && "opacity-60",
            )}
          >
            <span className="type-label">
              {day.isToday ? "Today" : formatWeekday(day.day)}
            </span>
            <span className="type-caption text-muted-foreground">
              {formatDateOnly(day.day)}
            </span>
            {/* Owner only — `capacity` is absent from the staff payload
                entirely, so this cannot render for them by construction. */}
            {day.capacity?.over && (
              <span className="type-caption ml-auto rounded-full bg-warn-soft px-2 py-0.5 text-warn-foreground">
                <span className="numeric">{day.capacity.hours}</span> h
                scheduled
              </span>
            )}
          </h2>
          <ul className="flex flex-col gap-2 pb-4">
            {/* Order: what to start, then what is due. Starting is the thing
                she can still change; a delivery is already decided. */}
            {day.prompts.map((p) => (
              <StartCard key={`${p.menuItemId}-${p.startDay}`} prompt={p} orgSlug={orgSlug} />
            ))}
            {day.isStocktake && (
              <StocktakeCard orgSlug={orgSlug} canRecord={canRecordStocktake} />
            )}
            {day.due.map((d) => (
              <DueCard key={d.orderId} entry={d} orgSlug={orgSlug} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
