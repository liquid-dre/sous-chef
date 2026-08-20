"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/day";
import { monthGridDays, shiftDay, windowFor, type CalendarView } from "@/convex/lib/schedule";
import { AgendaList } from "./agenda-list";
import { MonthGrid } from "./month-grid";
import { DayDetail } from "./day-detail";
import { daysFrom, type CalendarData } from "./types";

/**
 * The calendar, free of Convex so the specimen can mount every state.
 *
 * MOBILE IS AN AGENDA, DESKTOP IS A GRID, and both come from ONE payload —
 * the CSS split (`md:hidden` / `hidden md:block`) that
 * `feedback-sheet.tsx:255-286` already uses for its drawer/popover pair. A
 * month grid is 42 cells; rendering both costs DOM, not a second query, and
 * it means the two can never disagree about what is on a Thursday because
 * they read the same bucketed days.
 *
 * The mobile default is a WEEK rather than a month. The design note says to
 * resist a month grid on a phone, and an agenda of a whole month is 30
 * sticky headers to thumb past to find Thursday. A week is the horizon
 * someone standing in a kitchen actually plans over.
 */

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export function CalendarScreen({
  data,
  orgSlug,
  view,
  anchorDay,
  onViewChange,
  onAnchorChange,
  isOwner,
  charts,
}: {
  data: CalendarData;
  orgSlug: string;
  view: CalendarView;
  anchorDay: string;
  onViewChange: (next: CalendarView) => void;
  onAnchorChange: (nextAnchorDay: string) => void;
  isOwner: boolean;
  /** The two owner-only charts, injected so this component stays free of
   * both Convex and the chart bundle — the specimen mounts it without
   * either. */
  charts?: React.ReactNode;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);

  const windowDays = React.useMemo(() => {
    if (view === "month") return monthGridDays(anchorDay);
    const { start } = windowFor("week", anchorDay);
    return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
  }, [view, anchorDay]);

  const days = React.useMemo(() => daysFrom(data, windowDays), [data, windowDays]);
  const monthStart = windowFor("month", anchorDay).start;

  // The detail panel follows the selection, and falls back to today when she
  // has not picked one — the day she is most likely to be asking about.
  const detail =
    days.find((d) => d.day === selected) ??
    days.find((d) => d.isToday) ??
    days.find((d) => !d.isPast) ??
    days[0];

  const step = (direction: 1 | -1) => {
    onAnchorChange(shiftDay(anchorDay, direction * (view === "week" ? 7 : 30)));
    setSelected(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-display">Calendar</h1>
          <p className="type-body text-muted-foreground">
            {formatDay(data.start)} – {formatDay(data.end)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Paging. No animation on the change: she does this dozens of
              times and DESIGN.md §6 names calendar day taps outright. */}
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 md:min-h-9"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
            onClick={() => step(-1)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 md:min-h-9"
            aria-label={view === "week" ? "Next week" : "Next month"}
            onClick={() => step(1)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
          <div
            className="flex gap-1"
            role="group"
            aria-label="How much to show"
          >
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                aria-pressed={view === v.value}
                onClick={() => {
                  onViewChange(v.value);
                  setSelected(null);
                }}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border px-4 type-label outline-none",
                  "transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-out",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-9",
                  view === v.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MOBILE: the agenda. A month grid at 375px gives 50px cells that hold
          two characters and miss the 44px tap target. */}
      <div className="md:hidden">
        <AgendaList
          days={days}
          orgSlug={orgSlug}
          canRecordStocktake={isOwner}
        />
      </div>

      {/* DESKTOP: the grid, with the selected day beside it. */}
      <div className="hidden gap-4 md:grid md:grid-cols-[1fr_20rem]">
        <MonthGrid
          days={days}
          monthStart={monthStart}
          selected={detail?.day ?? null}
          onSelect={setSelected}
        />
        {detail && (
          <DayDetail
            day={detail}
            orgSlug={orgSlug}
            canRecordStocktake={isOwner}
            ceilingHours={data.capacity?.ceilingHours}
          />
        )}
      </div>

      {/* Owner only, and injected rather than imported so the staff bundle
          never carries the chart code at all. */}
      {charts}
    </div>
  );
}
