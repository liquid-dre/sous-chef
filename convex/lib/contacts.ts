/**
 * Contacts, and the one rule in Sous that must never be wrong.
 *
 * A reorder reminder reaches a real person on a date that meant something to
 * them. Get it right and it is the most useful thing Sous does all month; get
 * it wrong and it is a message about somebody's funeral. CONTEXT.md is blunt
 * about which — "it is the kind of mistake that ends a customer relationship
 * permanently" — and that asymmetry shapes every decision in this file:
 *
 * - Recurrence is an ALLOW-LIST, never a deny-list. A new occasion chip added
 *   in six months defaults to silent. Nothing recurs unless it is named here.
 * - Every gate is a filter, not a flag. Consent, recurrence and "have they
 *   already reordered" each remove candidates; none of them can be overridden
 *   downstream, because there is no downstream — the list IS the output.
 * - Nothing is stored. A reminder is a pure function of order history and
 *   today, so a customer who opts out disappears from the next read with no
 *   cleanup job needing to have run. That is what makes "immediately and
 *   permanently" true by construction.
 *
 * Pure: no Convex, no clock. Her day always arrives as an argument, because
 * the server runs UTC and has no "today" (lib/day.ts).
 */

export type Occasion =
  | "birthday"
  | "anniversary"
  | "wedding"
  | "funeral"
  | "church"
  | "corporate"
  | "justBecause";

/**
 * The only place recurrence is decided.
 *
 * An ALLOW-LIST, and that direction is the whole safety property: an eighth
 * chip added later is silent until somebody deliberately adds it here, rather
 * than generating reminders because nobody remembered to exclude it.
 *
 * A WEDDING is not on this list and that is not an oversight — nobody marries
 * annually. The couple's anniversary is a different chip she would tag next
 * year, and reaching out on the anniversary of somebody's wedding-cake order
 * is a guess about their marriage.
 *
 * CHURCH and CORPORATE are sometimes annual fixtures and sometimes one-offs,
 * and a chip cannot tell Sous which. A missed reminder costs one message she
 * could have sent herself; a wrong one costs the customer.
 */
export const RECURRING: ReadonlySet<Occasion> = new Set<Occasion>([
  "birthday",
  "anniversary",
]);

export function recurs(occasion: Occasion | null): boolean {
  return occasion !== null && RECURRING.has(occasion);
}

// --- Day arithmetic -------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** Pure string arithmetic through Date.UTC, so no timezone enters — the same
 * choice convex/lib/stock.ts and convex/lib/schedule.ts made. */
function epochDayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY);
}

function dayFromEpoch(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  return dayFromEpoch(epochDayOf(day) + days);
}

export function daysBetween(from: string, to: string): number {
  return epochDayOf(to) - epochDayOf(from);
}

/**
 * The next time this date comes round, on or after today.
 *
 * 29 February is the case worth writing down: an order delivered on a leap day
 * has no anniversary in three years out of four. Clamping to 28 February is
 * the convention every calendar app uses and the only one that keeps the
 * reminder in the right week — dropping it entirely would mean a customer
 * born on the 29th never hears from her.
 */
export function nextAnniversary(pastDay: string, today: string): string {
  const [, month, dayOfMonth] = pastDay.split("-").map(Number);
  const thisYear = Number(today.slice(0, 4));

  const on = (year: number): string => {
    // Day 0 of the next month is the last day of this one, so this handles
    // February and leap years without a table.
    const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const clamped = Math.min(dayOfMonth, lastOfMonth);
    return `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
  };

  const candidate = on(thisYear);
  return candidate >= today ? candidate : on(thisYear + 1);
}

// --- Lead time ------------------------------------------------------------

/** Time for them to read it, think, and reply. Reaching out the morning
 * before is not a reminder, it is an apology. */
export const DECISION_DAYS = 7;

/**
 * How far ahead a reminder surfaces.
 *
 * A week to decide, PLUS however long the thing they bought last year takes
 * to make. A wedding cake with a fortnight's lead time is useless news ten
 * days out; a batch of cupcakes needs nothing like that much warning. The
 * field is already on every menu item and already drives `defaultDeliveryDay`
 * and the calendar's backward scheduling — this is the third reader, not a
 * new concept.
 */
export function reminderLeadDays(leadTimeHours: number | null): number {
  return DECISION_DAYS + Math.ceil(Math.max(0, leadTimeHours ?? 0) / 24);
}

// --- Reminders ------------------------------------------------------------

export interface OrderFact {
  orderId: string;
  customerId: string;
  customerName: string;
  phone: string;
  /** False means she must never be sent anything. */
  marketingConsent: boolean;
  deliveryDate: string;
  occasion: Occasion | null;
  /** What they bought, for the message and for the lead time. */
  itemName: string | null;
  leadTimeHours: number | null;
}

export interface Reminder {
  /** Stable across reads, so a dismissal can name exactly one reminder:
   * the order it came from plus the year it is for. */
  key: string;
  orderId: string;
  customerId: string;
  customerName: string;
  phone: string;
  occasion: Occasion;
  itemName: string | null;
  /** The day it happened last time. */
  lastOrderedOn: string;
  /** The day it comes round again. */
  dueOn: string;
  daysAway: number;
}

export function reminderKey(orderId: string, dueOn: string): string {
  return `${orderId}:${dueOn.slice(0, 4)}`;
}

/**
 * Who to reach out to, and when.
 *
 * THREE GATES, each of which removes candidates and none of which can be
 * undone later:
 *
 *   1. Consent. Opted out means absent, on this read and every read after.
 *   2. Recurrence. Only what `RECURRING` names.
 *   3. Already back. A customer who has ordered since that anniversary last
 *      came round does not need chasing about it — she has them.
 *
 * The order of the gates does not matter to the result; it matters to the
 * reading. Consent first, because it is the one with a statute behind it.
 */
export function dueReminders(
  history: readonly OrderFact[],
  today: string,
  suppressed: ReadonlySet<string> = new Set(),
): Reminder[] {
  // The most recent order per customer, so gate 3 can ask "have they been
  // back since". Computed once rather than per candidate.
  const lastOrderOn = new Map<string, string>();
  for (const fact of history) {
    const seen = lastOrderOn.get(fact.customerId);
    if (!seen || fact.deliveryDate > seen) {
      lastOrderOn.set(fact.customerId, fact.deliveryDate);
    }
  }

  const out: Reminder[] = [];
  for (const fact of history) {
    // GATE 1 — consent. POPIA and Zimbabwe's Data Protection Act both require
    // it for direct marketing, and it is checked here rather than at the
    // call site so no caller can forget.
    if (!fact.marketingConsent) continue;

    // GATE 2 — recurrence. An allow-list; see RECURRING.
    if (!recurs(fact.occasion)) continue;
    const occasion = fact.occasion as Occasion;

    const dueOn = nextAnniversary(fact.deliveryDate, today);
    const daysAway = daysBetween(today, dueOn);
    if (daysAway > reminderLeadDays(fact.leadTimeHours)) continue;

    // GATE 3 — already back. If they have ordered since the run-up began,
    // she does not need reminding to chase them.
    const windowOpenedOn = shiftDay(dueOn, -reminderLeadDays(fact.leadTimeHours));
    const last = lastOrderOn.get(fact.customerId);
    if (last && last > fact.deliveryDate && last >= windowOpenedOn) continue;

    const key = reminderKey(fact.orderId, dueOn);
    if (suppressed.has(key)) continue;

    out.push({
      key,
      orderId: fact.orderId,
      customerId: fact.customerId,
      customerName: fact.customerName,
      phone: fact.phone,
      occasion,
      itemName: fact.itemName,
      lastOrderedOn: fact.deliveryDate,
      dueOn,
      daysAway,
    });
  }

  // Soonest first, then by name so two on the same day are stable.
  return out.sort(
    (a, b) => a.daysAway - b.daysAway || a.customerName.localeCompare(b.customerName),
  );
}

// --- Repeat versus first-time --------------------------------------------

/**
 * The least this file needs to know about an order.
 *
 * Deliberately NOT `PnlOrder`. `convex/lib/pnl.ts` imports `Occasion` from
 * here, so importing its order type back would be a cycle — and the smaller
 * shape is the better design regardless: recurrence and repeat-rate are
 * facts about who ordered and when, not about how the money split.
 */
export interface OrderIdentity {
  id: string;
  customerId: string | null;
  occasion?: Occasion | null;
}

export interface RepeatSplit {
  repeatCents: number;
  firstTimeCents: number;
  repeatPercent: number | null;
  repeatOrders: number;
  firstTimeOrders: number;
}

/**
 * Revenue from people coming back, against revenue from people arriving.
 *
 * PER ORDER, judged against ALL history — `firstOrderIds` is built from the
 * whole order book, not from the window. A customer who first ordered in 2024
 * and orders again this month is REPEAT, which is what returning means; the
 * alternative reads a two-year regular as a new face whenever the window
 * happens to start after their last visit.
 *
 * Per order rather than per customer is what lets the figure move. Classify
 * the PERSON and their very first order is retroactively relabelled the
 * moment they come back, so the split only ever drifts toward repeat and
 * stops answering the question the chart exists for.
 */
export function repeatSplit<T extends OrderIdentity>(
  orders: readonly T[],
  firstOrderIds: ReadonlySet<string>,
  revenueOf: (order: T) => number,
): RepeatSplit {
  let repeatCents = 0;
  let firstTimeCents = 0;
  let repeatOrders = 0;
  let firstTimeOrders = 0;

  for (const order of orders) {
    // A walk-in is nobody in particular, so it can never be a return visit.
    // Counting counter sales as first-time revenue is the honest reading:
    // Sous genuinely does not know whether that person has been in before.
    const isFirst = order.customerId === null || firstOrderIds.has(order.id);
    const revenue = revenueOf(order);
    if (isFirst) {
      firstTimeCents += revenue;
      firstTimeOrders += 1;
    } else {
      repeatCents += revenue;
      repeatOrders += 1;
    }
  }

  const total = repeatCents + firstTimeCents;
  return {
    repeatCents,
    firstTimeCents,
    // Null rather than zero when there is no revenue: "0% repeat" is a claim
    // about a business that has not traded yet (DESIGN.md §7).
    repeatPercent: total > 0 ? Math.round((repeatCents * 100) / total) : null,
    repeatOrders,
    firstTimeOrders,
  };
}

// --- Occasion mix ---------------------------------------------------------

export interface OccasionRow {
  occasion: Occasion;
  orders: number;
  revenueCents: number;
}

/**
 * Which occasions are worth building a campaign around.
 *
 * Orders with no occasion chip are EXCLUDED rather than bucketed into an
 * "other" row. She did not tell Sous what they were for, and inventing a
 * seventh category out of missing data would be the largest bar on the chart
 * and mean nothing.
 */
export function occasionMix<T extends OrderIdentity>(
  orders: readonly T[],
  revenueOf: (order: T) => number,
): OccasionRow[] {
  const byOccasion = new Map<Occasion, OccasionRow>();
  for (const order of orders) {
    const occasion = order.occasion ?? null;
    if (occasion === null) continue;
    const entry = byOccasion.get(occasion) ?? {
      occasion,
      orders: 0,
      revenueCents: 0,
    };
    entry.orders += 1;
    entry.revenueCents += revenueOf(order);
    byOccasion.set(occasion, entry);
  }
  return [...byOccasion.values()].sort(
    (a, b) => b.orders - a.orders || a.occasion.localeCompare(b.occasion),
  );
}

/** Her words for a chip, matching components/orders/occasion-chips.tsx. */
export const OCCASION_LABEL: Record<Occasion, string> = {
  birthday: "Birthday",
  anniversary: "Anniversary",
  wedding: "Wedding",
  funeral: "Funeral",
  church: "Church",
  corporate: "Corporate",
  justBecause: "Just because",
};
