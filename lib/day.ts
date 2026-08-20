/**
 * Domain days as "YYYY-MM-DD" strings (convex/schema.ts), in HER timezone.
 *
 * These must be computed on the client, never on the server. A Convex
 * mutation runs in UTC, so an order taken at 01:00 in Harare would be filed
 * to the previous day — landing on the wrong calendar day and the wrong
 * revenue day, permanently, for the orders taken latest at night.
 *
 * Lifted from the four private copies that had accumulated across the chart
 * and invoice components; those should converge on this.
 */

export function toDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today, in the timezone of whoever is looking at the screen. */
export function today(): string {
  return toDay(new Date());
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(day: string, days: number): string {
  const date = parseDay(day);
  date.setDate(date.getDate() + days);
  return toDay(date);
}

/** ISO days compare correctly as plain strings — no parsing needed. */
export function isValidDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(parseDay(day).getTime());
}

/**
 * "Fri, 7 Aug" — a day in her words.
 *
 * Lifted from the two verbatim copies that had accumulated in
 * `components/orders/orders-list.tsx` and
 * `components/production/production-form.tsx`; the calendar would have been
 * the third, which is the point at which a private copy stops being cheaper
 * than a shared one.
 */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "Friday" — the full weekday, for a calendar's own section headers where
 * the abbreviation reads as a shrug. */
export function formatWeekday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
}

/**
 * "8 Aug 2025" — with the year, for a date in another year.
 *
 * An anniversary reminder puts last year's order beside this year's date, and
 * they are the same day of the month by definition. Without the year the two
 * read as a contradiction: "Fri, Aug 8" and "Sat, Aug 8" look like a bug
 * rather than like two different years.
 */
export function formatDayWithYear(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "5 Aug" — the date WITHOUT its weekday, for the one place the weekday is
 * already the thing beside it. "Thursday · Thu, Aug 6" says it twice. */
export function formatDateOnly(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

/**
 * The delivery date Sous proposes: at least tomorrow, and at least the
 * longest lead time among the items ordered (CONTEXT.md — Orders).
 */
export function defaultDeliveryDay(
  orderDay: string,
  leadTimeHours: (number | null)[],
): string {
  const maxLead = leadTimeHours.reduce<number>((max, h) => Math.max(max, h ?? 0), 0);
  return addDays(orderDay, Math.max(1, Math.ceil(maxLead / 24)));
}
