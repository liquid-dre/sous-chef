import type { Prompt } from "@/convex/lib/schedule";

/**
 * The calendar's view model, free of Convex so the specimen can mount every
 * screen without a kitchen behind it — the same split
 * `components/production/production-form.tsx` uses.
 *
 * `capacity` is OPTIONAL and that is load-bearing rather than convenient: the
 * server omits the key entirely for staff (convex/calendar.ts), so an absent
 * capacity here is not "we forgot to pass it", it is "this person is not
 * allowed to have it". Typing it as optional makes every consumer handle the
 * staff case at compile time.
 */

export interface DueEntry {
  orderId: string;
  who: string;
  deliveryDay: string;
  summary: string;
  status: "confirmed" | "delivered" | "cancelled";
}

export type PromptEntry = Prompt & { overdue: boolean };

export interface CapacityDay {
  day: string;
  hours: number;
  over: boolean;
}

export interface CalendarData {
  start: string;
  end: string;
  today: string;
  due: DueEntry[];
  prompts: PromptEntry[];
  stocktakeDays: string[];
  /** Owner only. Absent means staff, never "zero hours". */
  capacity?: { ceilingHours: number; byDay: CapacityDay[] };
}

/** One day's worth of everything, which is what both the agenda row and the
 * month cell render from. */
export interface CalendarDay {
  day: string;
  due: DueEntry[];
  prompts: PromptEntry[];
  isStocktake: boolean;
  capacity: CapacityDay | null;
  isToday: boolean;
  isPast: boolean;
}

/** Bucket the flat payload into days. Done once, here, so the agenda and the
 * month grid cannot disagree about what is on a Thursday. */
export function daysFrom(data: CalendarData, days: string[]): CalendarDay[] {
  const dueBy = new Map<string, DueEntry[]>();
  for (const d of data.due) {
    const bucket = dueBy.get(d.deliveryDay);
    if (bucket) bucket.push(d);
    else dueBy.set(d.deliveryDay, [d]);
  }
  const promptsBy = new Map<string, PromptEntry[]>();
  for (const p of data.prompts) {
    const bucket = promptsBy.get(p.startDay);
    if (bucket) bucket.push(p);
    else promptsBy.set(p.startDay, [p]);
  }
  const stocktakes = new Set(data.stocktakeDays);
  const capacityBy = new Map((data.capacity?.byDay ?? []).map((c) => [c.day, c]));

  return days.map((day) => ({
    day,
    due: dueBy.get(day) ?? [],
    prompts: promptsBy.get(day) ?? [],
    isStocktake: stocktakes.has(day),
    capacity: capacityBy.get(day) ?? null,
    isToday: day === data.today,
    isPast: day < data.today,
  }));
}

export function isEmptyDay(d: CalendarDay): boolean {
  return d.due.length === 0 && d.prompts.length === 0 && !d.isStocktake;
}
