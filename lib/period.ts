/**
 * Period arithmetic, pure and free of React.
 *
 * Extracted out of components/charts-sous/use-period.tsx so a SERVER component
 * can compute the same window the client will. That matters for exactly one
 * reason: Home's claim sentence is rendered on the server, and if the two
 * disagreed about which month it is, hydration would swap one set of numbers
 * for another in front of her.
 *
 * "The server has no today" is still the rule (CONTEXT.md). Nothing here reads
 * a clock on its own — `dayInTimeZone` needs a timezone the browser told us,
 * and everything else takes a day string.
 */

export type PeriodKey = "week" | "month" | "quarter" | "year" | "all";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "Last 3 months" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

export interface PeriodBounds {
  /** Inclusive "YYYY-MM-DD"; undefined = unbounded (All time). */
  start?: string;
  end: string;
}

function toDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function boundsFor(key: PeriodKey, today = new Date()): PeriodBounds {
  const end = toDay(today);
  switch (key) {
    case "week": {
      const start = new Date(today);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
      return { start: toDay(start), end };
    }
    case "month":
      return { start: toDay(new Date(today.getFullYear(), today.getMonth(), 1)), end };
    case "quarter": {
      const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      return { start: toDay(start), end };
    }
    case "year":
      return { start: toDay(new Date(today.getFullYear(), 0, 1)), end };
    case "all":
      return { end };
  }
}

/**
 * Bounds from a domain DAY rather than a Date.
 *
 * Timezone-independent, and the reason is worth stating precisely because the
 * obvious reason is wrong: it is NOT the noon anchor. `new Date(y, m, d, h)`
 * builds in the process's local time and `getFullYear`/`getMonth`/`getDate`
 * read it back in the same local time, so the round trip cancels out whatever
 * the server's offset is — verified by running this file's tests under
 * Pacific/Kiritimati (UTC+14) and Pacific/Midway (UTC-11).
 *
 * Noon is kept as cheap insurance for anyone who later swaps this for a
 * UTC-parsed date, where construction and reading would no longer agree and
 * midnight would fall off the end of the day.
 */
export function boundsForDay(key: PeriodKey, day: string): PeriodBounds {
  const [y, m, d] = day.split("-").map(Number);
  return boundsFor(key, new Date(y, (m ?? 1) - 1, d ?? 1, 12));
}

/**
 * HER today, from a timezone the browser reported.
 *
 * en-CA formats as YYYY-MM-DD, which is the domain-day shape the schema uses.
 * Returns null for a timezone Intl refuses, so a tampered cookie degrades to
 * "we don't know her day" rather than to a wrong month.
 */
export function dayInTimeZone(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return null;
  }
}

export function filterByPeriod<T extends { date: string }>(
  rows: T[],
  bounds: PeriodBounds,
): T[] {
  return rows.filter(
    (r) => r.date <= bounds.end && (!bounds.start || r.date >= bounds.start),
  );
}
