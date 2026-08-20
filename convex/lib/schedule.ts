/**
 * Working backwards from a delivery date to the day she has to start.
 *
 * Everything in Sous until now has run forwards — an order is taken, a
 * delivery date is proposed, a batch is logged after the fact. The calendar is
 * the first thing that has to answer "what do I start today so Friday is not a
 * disaster", and nothing in the codebase could do that: `lib/day.ts`'s
 * `defaultDeliveryDay` goes order → delivery, and nothing goes the other way.
 *
 * Three ideas carry the module.
 *
 * 1. **The binding constraint wins.** A start date is the later of the lead
 *    time she promised the customer and the time the bake physically takes.
 *    Using either alone is wrong in a predictable direction: lead time alone
 *    schedules a sixteen-hour cake on the morning it is due, and batch
 *    duration alone ignores a promise she has already made.
 *
 * 2. **Shelf life is what lets two orders share a batch.** Batch granularity
 *    is her main waste source, so consolidating matters — but only where the
 *    food survives. A 72-hour brownie can cover Thursday and Saturday from one
 *    tray; a 24-hour cream bun cannot, and merging it would be Sous
 *    confidently telling her to serve something that went off yesterday.
 *
 * 3. **Capacity flags, never blocks.** Sous does not know that she has help on
 *    Fridays or that Thursday is a public holiday. It can say the day is over
 *    her own stated ceiling; it cannot say she is wrong.
 *
 * Pure: no Convex, no clock. Her day always arrives as an argument, because
 * the server runs UTC and has no "today" (lib/day.ts).
 */

/**
 * How much longer than the bake itself to allow.
 *
 * A batch is not the only thing that happens that day, and a tray that comes
 * out of the oven at the moment the customer arrives has no cooling, no
 * icing and no packing time. One and a half times is the scope's own figure
 * ("a batch taking a day prompts a start a day and a half ahead").
 */
export const BUFFER = 1.5;

/** Until she says otherwise. A working day, which is what most people mean by
 * a full day of baking — and it is a number she can change the moment it is
 * wrong for her, which is the whole reason it is a setting. */
export const DEFAULT_CAPACITY_HOURS = 8;

const MS_PER_DAY = 86_400_000;

// --- Day arithmetic -------------------------------------------------------

/**
 * Days since the epoch, from a "YYYY-MM-DD".
 *
 * Pure string arithmetic through `Date.UTC`, deliberately — the same choice
 * `convex/lib/stock.ts` made. `lib/day.ts`'s `addDays` round-trips through a
 * LOCAL `Date`, which is correct in Harare and on a UTC server but silently
 * loses a day across a daylight-saving boundary. A calendar is the one screen
 * where that would be visible.
 */
export function epochDayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY);
}

export function dayFromEpoch(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  return dayFromEpoch(epochDayOf(day) + days);
}

/** 1970-01-01 was a Thursday; Sunday = 0, matching Date#getDay and
 * orgs.stocktakeDay. */
export function weekdayOf(day: string): number {
  return (((epochDayOf(day) + 4) % 7) + 7) % 7;
}

// --- Backward scheduling --------------------------------------------------

/**
 * The day she has to start, for one delivery.
 *
 * `max` of the two constraints, rounded UP to whole days — she works in days,
 * and "start 1.4 days ahead" is not something anybody can act on. Never later
 * than the delivery day itself, and never earlier than… nothing: an order
 * taken for tomorrow with a three-day lead time yields a start date in the
 * past, which is TRUE and worth saying rather than quietly clamping to today.
 * The caller decides how to render a start date that has already gone.
 */
export function startDayFor(
  deliveryDay: string,
  leadTimeHours: number | null,
  batchProductionMinutes: number,
): string {
  const leadDays = (leadTimeHours ?? 0) / 24;
  const bakeDays = ((batchProductionMinutes * BUFFER) / 60) / 24;
  const days = Math.ceil(Math.max(leadDays, bakeDays));
  return shiftDay(deliveryDay, -Math.max(0, days));
}

// --- Consolidation --------------------------------------------------------

export interface Demand {
  orderId: string;
  /** For "one batch covers Tariro and Rudo". */
  who: string;
  deliveryDay: string;
  menuItemId: string;
  itemName: string;
  qtyMilli: number;
  baseBatchYield: number;
  leadTimeHours: number | null;
  batchProductionMinutes: number;
  /** Null means it never expires — sub-recipes, and the same reading
   * `production.isLive` already takes of an absent `overhangExpiresAt`. */
  shelfLifeHours: number | null;
}

export interface Prompt {
  menuItemId: string;
  itemName: string;
  /** The day the prompt sits on. */
  startDay: string;
  /** The earliest delivery it is for — the one that set the start day. */
  firstDeliveryDay: string;
  lastDeliveryDay: string;
  qtyMilli: number;
  batchCount: number;
  /** Every order this one batch covers. Length > 1 is the consolidation, and
   * it is what the card says out loud. */
  covers: { orderId: string; who: string; deliveryDay: string; qtyMilli: number }[];
  batchProductionMinutes: number;
}

/** Whole batches, rounded up. A half tray is not a thing she can make. */
function batchesFor(qtyMilli: number, baseBatchYield: number): number {
  const perBatch = baseBatchYield > 0 ? baseBatchYield : 1;
  return Math.max(1, Math.ceil(qtyMilli / 1000 / perBatch));
}

/**
 * One prompt per batch that actually needs making.
 *
 * Greedy, earliest delivery first, and the rule is physical rather than
 * calendrical: a batch started on S is made on S, so it can cover any delivery
 * from S up to S + shelf life. The EARLIEST delivery in a group sets the start
 * day, because that is the constraint that binds; later deliveries join only
 * while the food is still good on their date.
 *
 * The consequence worth stating: this is why the acceptance case works
 * without being special-cased. Two orders on the same Thursday share a start
 * day and trivially share a batch. A Thursday and a Saturday share one too,
 * but only if the item lasts that long.
 */
export function consolidate(demands: readonly Demand[]): Prompt[] {
  const byItem = new Map<string, Demand[]>();
  for (const demand of demands) {
    const bucket = byItem.get(demand.menuItemId);
    if (bucket) bucket.push(demand);
    else byItem.set(demand.menuItemId, [demand]);
  }

  const prompts: Prompt[] = [];
  for (const [menuItemId, items] of byItem) {
    // Earliest delivery first, then by order id so the result does not depend
    // on the order rows happened to arrive in — a prompt that moved because
    // two orders swapped places would be impossible to trust.
    const sorted = [...items].sort(
      (a, b) =>
        a.deliveryDay.localeCompare(b.deliveryDay) ||
        a.orderId.localeCompare(b.orderId),
    );

    let group: Demand[] = [];
    let startDay = "";
    let lastCoverableDay = "";

    const flush = () => {
      if (group.length === 0) return;
      const head = group[0];
      const qtyMilli = group.reduce((sum, d) => sum + d.qtyMilli, 0);
      prompts.push({
        menuItemId,
        itemName: head.itemName,
        startDay,
        firstDeliveryDay: head.deliveryDay,
        lastDeliveryDay: group[group.length - 1].deliveryDay,
        qtyMilli,
        batchCount: batchesFor(qtyMilli, head.baseBatchYield),
        covers: group.map((d) => ({
          orderId: d.orderId,
          who: d.who,
          deliveryDay: d.deliveryDay,
          qtyMilli: d.qtyMilli,
        })),
        batchProductionMinutes: head.batchProductionMinutes,
      });
      group = [];
    };

    for (const demand of sorted) {
      if (group.length === 0) {
        startDay = startDayFor(
          demand.deliveryDay,
          demand.leadTimeHours,
          demand.batchProductionMinutes,
        );
        // Made on the start day, good for its shelf life from there. Null
        // shelf life never expires, so the group stays open.
        lastCoverableDay =
          demand.shelfLifeHours === null
            ? "9999-12-31"
            : shiftDay(startDay, Math.floor(demand.shelfLifeHours / 24));
        group.push(demand);
        continue;
      }
      if (demand.deliveryDay <= lastCoverableDay) {
        group.push(demand);
        continue;
      }
      // Out of range — this batch cannot reach it. Close the group and open a
      // new one on the same item.
      flush();
      startDay = startDayFor(
        demand.deliveryDay,
        demand.leadTimeHours,
        demand.batchProductionMinutes,
      );
      lastCoverableDay =
        demand.shelfLifeHours === null
          ? "9999-12-31"
          : shiftDay(startDay, Math.floor(demand.shelfLifeHours / 24));
      group.push(demand);
    }
    flush();
  }

  return prompts.sort(
    (a, b) => a.startDay.localeCompare(b.startDay) || a.itemName.localeCompare(b.itemName),
  );
}

// --- Capacity -------------------------------------------------------------

/** Scheduled bake hours per start day, one decimal's worth of precision kept
 * as a float — the caller rounds for display. */
export function hoursByDay(prompts: readonly Prompt[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of prompts) {
    const hours = (p.batchProductionMinutes * p.batchCount) / 60;
    out.set(p.startDay, (out.get(p.startDay) ?? 0) + hours);
  }
  return out;
}

/**
 * Over her own stated ceiling.
 *
 * FLAGS, NEVER BLOCKS — the scope says so twice and it is the same ethic the
 * optimiser runs on. Sous does not know she has help on Fridays, or that she
 * planned to start at five. It knows the arithmetic exceeds the number she
 * herself typed, and saying that is the whole of its business here.
 */
export function overCapacity(hours: number, ceilingHours: number): boolean {
  const ceiling = ceilingHours > 0 ? ceilingHours : DEFAULT_CAPACITY_HOURS;
  return hours > ceiling;
}

// --- The window -----------------------------------------------------------

export type CalendarView = "week" | "month";

/**
 * The visible range, forwards.
 *
 * `lib/period.ts`'s `boundsFor` cannot do this: every one of its cases ends at
 * today, because it was built for looking back at what happened. A calendar
 * is the opposite screen.
 *
 * Weeks start MONDAY, matching `lib/period.ts:43`. That deliberately differs
 * from the heatmap's Sunday-first default, which is a rendering choice about a
 * GitHub-style grid rather than a claim about when her week begins.
 */
export function windowFor(
  view: CalendarView,
  anchorDay: string,
): { start: string; end: string } {
  if (view === "week") {
    const back = (weekdayOf(anchorDay) + 6) % 7; // Monday = 0
    const start = shiftDay(anchorDay, -back);
    return { start, end: shiftDay(start, 6) };
  }
  const [y, m] = anchorDay.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  // Day 0 of the NEXT month is the last day of this one, and it gets February
  // and leap years right without a table.
  const lastDate = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${y}-${String(m).padStart(2, "0")}-${String(lastDate).padStart(2, "0")}` };
}

/** The grid a month view draws: whole weeks, Monday-first, covering the month.
 * Always 6 rows so the desktop grid does not change height month to month —
 * a layout that jumps as she pages through is the thing month grids get
 * wrong most often. */
export function monthGridDays(anchorDay: string): string[] {
  const { start } = windowFor("month", anchorDay);
  const back = (weekdayOf(start) + 6) % 7;
  const first = shiftDay(start, -back);
  return Array.from({ length: 42 }, (_, i) => shiftDay(first, i));
}
