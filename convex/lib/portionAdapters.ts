import type { Doc } from "../_generated/dataModel";
import type { BatchFact, PortionRating } from "./portionEvidence";

/**
 * Convex documents → the pure engine's inputs.
 *
 * Kept in one place because two callers need the identical translation —
 * `menuItems.getForBuilder` reads it, and `optimiserOverrides.record` stamps
 * what she was shown. If those two derived their figures differently, the
 * number frozen into the override would not be the number she overrode, and
 * the whole before/after report would compare against a fiction.
 */

/** The portionSize ratings on this item's feedback, order by order. */
export function portionRatings(rows: Doc<"feedback">[]): PortionRating[] {
  const out: PortionRating[] = [];
  for (const row of rows) {
    for (const rating of row.axisRatings) {
      if (rating.axis !== "portionSize") continue;
      out.push({
        orderId: row.orderId,
        value: rating.value,
        receivedAt: row.receivedAt,
      });
    }
  }
  return out;
}

/**
 * Production logs → the yield each was cut at.
 *
 * `expectedYieldMilli / batchCount` is the ONE place a past `baseBatchYield`
 * survives: `menuItems.save` overwrites the live field in place with no
 * history and no timestamp, so reading the item would assume away the very
 * change being measured. `production.ts` guarantees `batchCount > 0`, so the
 * divide is safe — the guard below is for a document written before that
 * check existed rather than for anything the mutation can produce.
 */
export function batchFacts(logs: Doc<"productionLogs">[]): BatchFact[] {
  return logs
    .filter((log) => log.batchCount > 0)
    .map((log) => ({
      productionLogId: log._id,
      orderIds: log.orderIds as string[],
      yieldUnits: Math.round(log.expectedYieldMilli / log.batchCount / 1000),
      batchCount: log.batchCount,
      producedAt: log.producedAt,
    }));
}
