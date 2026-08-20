/**
 * What she charges to deliver, and what it costs her.
 *
 * A separate module from invoice-totals because the fee is an *input* to
 * computeInvoiceTotals, and the order form and the save mutation must agree
 * on it exactly — the form shows a number, the server decides it.
 *
 * Every branch returns a reason as well as an amount. A fee of $0.00 means
 * three different things (free above the threshold, no km typed yet, the
 * model was never configured) and a screen that cannot tell them apart will
 * quote free delivery to someone who should be paying.
 */

export type DeliveryFeeModel = "flat" | "perKm" | "freeAbove";

export interface DeliveryFeeConfig {
  flatCents?: number;
  perKmCents?: number;
  /** Goods at or above this ship free. */
  freeAboveCents?: number;
}

export interface DeliveryFeeInput {
  model: DeliveryFeeModel;
  config: DeliveryFeeConfig;
  /**
   * Goods AFTER discount — the same figure computeInvoiceTotals calls
   * `goods`. Free delivery is earned by what the customer actually pays, not
   * by what the order was worth before she knocked money off it.
   */
  goodsCents: number;
  /** km × 1000. Read only under perKm. */
  kmMilli?: number | null;
}

export type DeliveryFeeReason =
  | "flat"
  | "perKm"
  /** Goods cleared the threshold. */
  | "freeAboveMet"
  /** Under the threshold, so the flat fee applies. */
  | "belowThreshold"
  /** perKm, but she hasn't typed the distance — a collection has no km. */
  | "noKm"
  /** The model needs an amount the org has never set. Say so; don't quote 0. */
  | "unconfigured";

export interface DeliveryFeeQuote {
  cents: number;
  reason: DeliveryFeeReason;
}

export function computeDeliveryFeeCents(input: DeliveryFeeInput): DeliveryFeeQuote {
  const { model, config, goodsCents, kmMilli } = input;

  if (model === "perKm") {
    if (config.perKmCents == null) return { cents: 0, reason: "unconfigured" };
    if (!kmMilli || kmMilli <= 0) return { cents: 0, reason: "noKm" };
    return {
      cents: Math.round((kmMilli * config.perKmCents) / 1000),
      reason: "perKm",
    };
  }

  if (model === "freeAbove") {
    const threshold = config.freeAboveCents ?? 0;
    if (goodsCents >= threshold) return { cents: 0, reason: "freeAboveMet" };
    // Below the threshold the flat fee applies. Without one configured every
    // order would ship free in silence, which is the one outcome she would
    // never have chosen deliberately.
    if (config.flatCents == null) return { cents: 0, reason: "unconfigured" };
    return { cents: config.flatCents, reason: "belowThreshold" };
  }

  if (config.flatCents == null) return { cents: 0, reason: "unconfigured" };
  return { cents: config.flatCents, reason: "flat" };
}

/** Her own fuel and time for a given distance — the cost side, not the fee. */
export function deliveryCostPrefillCents(
  kmMilli: number,
  centsPerKm: number,
): number {
  return Math.round((kmMilli * centsPerKm) / 1000);
}
