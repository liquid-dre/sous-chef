"use client";

import { cn } from "@/lib/utils";
import { isEmptyDay, type CalendarDay } from "./types";

/**
 * The desktop month grid.
 *
 * Desktop only, deliberately — `agenda-list.tsx` says why. Here there is room
 * for a cell to hold real content rather than a dot, so the grid earns its
 * place: the shape of a month IS the information, and seeing three heavy days
 * in a row is a thing a list cannot show.
 *
 * Always six rows (`monthGridDays` returns 42), so the grid does not change
 * height as she pages through months. A layout that jumps between February
 * and March is the thing month grids get wrong most often.
 *
 * No motion on selection. DESIGN.md §6 names calendar day taps outright.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthGrid({
  days,
  monthStart,
  selected,
  onSelect,
  className,
}: {
  days: CalendarDay[];
  /** Days outside this month render dimmed — they are context, not content. */
  monthStart: string;
  selected: string | null;
  onSelect: (day: string) => void;
  className?: string;
}) {
  const month = monthStart.slice(0, 7);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="type-caption px-1 text-muted-foreground">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const outside = !day.day.startsWith(month);
          const empty = isEmptyDay(day);
          return (
            <button
              key={day.day}
              type="button"
              onClick={() => onSelect(day.day)}
              aria-pressed={selected === day.day}
              aria-label={`${day.day}, ${day.due.length} due, ${day.prompts.length} to start`}
              className={cn(
                "flex min-h-24 flex-col gap-1 rounded-md border p-1.5 text-left outline-none",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                outside ? "bg-muted/30 text-muted-foreground" : "bg-card",
                selected === day.day && "border-primary",
                day.isToday && "ring-1 ring-primary",
                // Hover only, no transition — see the file header.
                !outside && "hover:bg-muted",
              )}
            >
              <span className="flex items-baseline justify-between gap-1">
                <span className={cn("numeric-sm", day.isToday && "font-semibold")}>
                  {Number(day.day.slice(8))}
                </span>
                {/* Owner only, and absent from the staff payload entirely. */}
                {day.capacity?.over && (
                  <span
                    aria-label="over your baking day"
                    className="size-1.5 rounded-full bg-warn"
                  />
                )}
              </span>

              {!empty && (
                <span className="flex min-w-0 flex-col gap-0.5">
                  {day.prompts.slice(0, 2).map((p) => (
                    <span
                      key={p.menuItemId}
                      className="type-caption truncate rounded bg-primary-soft px-1 text-primary"
                    >
                      Start {p.itemName}
                    </span>
                  ))}
                  {day.due.slice(0, 2).map((d) => (
                    <span
                      key={d.orderId}
                      className="type-caption truncate text-muted-foreground"
                    >
                      {d.who}
                    </span>
                  ))}
                  {/* The overflow count, never a silent truncation — a cell
                      showing two of five is a cell that lies about the day. */}
                  {day.prompts.length + day.due.length > 4 && (
                    <span className="type-caption text-muted-foreground">
                      +<span className="numeric">
                        {day.prompts.length + day.due.length - 4}
                      </span>{" "}
                      more
                    </span>
                  )}
                  {day.isStocktake && (
                    <span className="type-caption truncate text-muted-foreground">
                      Stocktake
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
