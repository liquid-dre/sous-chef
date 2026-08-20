// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  computeDeliveryFeeCents,
  deliveryCostPrefillCents,
  type DeliveryFeeConfig,
} from "./delivery-fee";

/**
 * A fee of $0.00 means three different things, and the reason channel is
 * what stops the order screen quoting free delivery to someone who should be
 * paying. Every branch is asserted on BOTH the amount and the reason.
 */

const quote = (
  model: "flat" | "perKm" | "freeAbove",
  config: DeliveryFeeConfig,
  goodsCents = 3000,
  kmMilli?: number | null,
) => computeDeliveryFeeCents({ model, config, goodsCents, kmMilli });

describe("flat", () => {
  test("charges the flat fee", () => {
    expect(quote("flat", { flatCents: 500 })).toEqual({ cents: 500, reason: "flat" });
  });

  test("says so when it was never configured, rather than quoting free", () => {
    expect(quote("flat", {})).toEqual({ cents: 0, reason: "unconfigured" });
  });
});

describe("perKm", () => {
  test("charges the rate for the distance typed", () => {
    // 7.5 km at 80c = 600c.
    expect(quote("perKm", { perKmCents: 80 }, 3000, 7_500)).toEqual({
      cents: 600,
      reason: "perKm",
    });
  });

  test("no distance typed is not an error — a collection has no km", () => {
    expect(quote("perKm", { perKmCents: 80 }, 3000, null)).toEqual({
      cents: 0,
      reason: "noKm",
    });
    expect(quote("perKm", { perKmCents: 80 }, 3000, 0)).toEqual({
      cents: 0,
      reason: "noKm",
    });
  });

  test("says so when the rate was never configured", () => {
    expect(quote("perKm", {}, 3000, 7_500)).toEqual({
      cents: 0,
      reason: "unconfigured",
    });
  });
});

describe("freeAbove", () => {
  const config = { freeAboveCents: 5000, flatCents: 500 };

  test("free at or above the threshold", () => {
    expect(quote("freeAbove", config, 6600)).toEqual({
      cents: 0,
      reason: "freeAboveMet",
    });
    // Exactly on the threshold ships free — "free over $50" includes $50.
    expect(quote("freeAbove", config, 5000)).toEqual({
      cents: 0,
      reason: "freeAboveMet",
    });
  });

  test("the flat fee applies below it", () => {
    expect(quote("freeAbove", config, 4999)).toEqual({
      cents: 500,
      reason: "belowThreshold",
    });
  });

  test("without a flat fee configured it refuses to quote free in silence", () => {
    // The hazard this reason exists for: everyone would ship free forever
    // and nothing would look wrong.
    expect(quote("freeAbove", { freeAboveCents: 5000 }, 1000)).toEqual({
      cents: 0,
      reason: "unconfigured",
    });
  });

  test("the threshold is judged on goods AFTER the discount", () => {
    // The caller passes post-discount goods; free delivery is earned by what
    // the customer actually pays. 6000 − 1500 = 4500, under the threshold.
    expect(quote("freeAbove", config, 4500)).toEqual({
      cents: 500,
      reason: "belowThreshold",
    });
  });
});

describe("her own cost side", () => {
  test("fuel and time scale with the distance", () => {
    // 7.5 km at 55c/km.
    expect(deliveryCostPrefillCents(7_500, 55)).toBe(413);
  });

  test("no rate set means no pre-fill, not a free delivery", () => {
    expect(deliveryCostPrefillCents(7_500, 0)).toBe(0);
  });
});
