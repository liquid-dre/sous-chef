import type { Grain } from "./format";

/**
 * The dense-data rule (grilled): a Sous chart never plots more than ~90
 * points. Rows arrive at day grain ("YYYY-MM-DD" domain days, matching the
 * schema); this picks the coarsest-necessary grain, sums every numeric
 * field per bucket, and reports the honest sample size for the chart's
 * n = note. 800 raw orders render as ~26 weekly points, stated as such —
 * never an unreadable smear.
 */

export interface DayRow {
  /** Domain day, "YYYY-MM-DD". */
  date: string;
  [key: string]: number | string;
}

export interface AggregatedSeries {
  points: ({ date: Date } & Record<string, number>)[];
  grain: Grain;
  /** Raw row count before bucketing — the number the n = note states. */
  sampleSize: number;
}

const MAX_POINTS = 90;

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Monday-start week bucket, as a local Date. */
function weekStart(date: Date): Date {
  const copy = new Date(date);
  const shift = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - shift);
  return copy;
}

function bucketDate(date: Date, grain: Grain): Date {
  if (grain === "day") return date;
  if (grain === "week") return weekStart(date);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function aggregateByGrain(rows: DayRow[]): AggregatedSeries {
  if (rows.length === 0) return { points: [], grain: "day", sampleSize: 0 };

  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = parseDay(sorted[0].date);
  const last = parseDay(sorted[sorted.length - 1].date);
  const spanDays =
    Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;

  const grain: Grain =
    spanDays <= MAX_POINTS
      ? "day"
      : spanDays / 7 <= MAX_POINTS
        ? "week"
        : "month";

  const buckets = new Map<number, { date: Date } & Record<string, number>>();
  for (const row of sorted) {
    const bucket = bucketDate(parseDay(row.date), grain);
    const key = bucket.getTime();
    let entry = buckets.get(key);
    if (!entry) {
      entry = { date: bucket } as { date: Date } & Record<string, number>;
      buckets.set(key, entry);
    }
    for (const [field, value] of Object.entries(row)) {
      if (typeof value !== "number") continue;
      entry[field] = (entry[field] ?? 0) + value;
    }
  }

  return {
    points: [...buckets.values()],
    grain,
    sampleSize: rows.length,
  };
}
