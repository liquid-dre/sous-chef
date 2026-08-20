import { describe, expect, test } from "vitest";
import { redactCosts } from "./redact";

describe("redactCosts", () => {
  const menuItem = {
    name: "Chocolate fudge cake",
    price: 32,
    standardCost: 8.1,
    variableCost: 9.3,
    overheadCost: 2.3,
    grossMargin: 0.71,
    netMargin: 0.63,
    targetGrossMargin: 0.65,
  };

  test("staff never receive cost-bearing fields", () => {
    const redacted = redactCosts("staff", menuItem);
    expect(redacted).toEqual({ name: "Chocolate fudge cake", price: 32 });
  });

  test("owners receive the document untouched", () => {
    expect(redactCosts("owner", menuItem)).toEqual(menuItem);
  });
});
