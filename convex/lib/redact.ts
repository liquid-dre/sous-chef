import type { Role } from "./functions";

/**
 * Cost-bearing fields are stripped server-side inside the query, never hidden
 * with CSS (CONTEXT.md — Access). Feature tables list their cost fields here
 * as they are added, and their queries call redactCosts before returning.
 */
export const COST_FIELDS = [
  "standardCost",
  "unitCost",
  "totalCost",
  "variableCost",
  "overheadCost",
  "costLayers",
  "grossMargin",
  "netMargin",
  "targetGrossMargin",
  "costOfGoods",
] as const;

type CostField = (typeof COST_FIELDS)[number];

/** Returns the document untouched for owners; a copy without cost fields for
 * staff. The return type drops the fields so client code for staff surfaces
 * cannot even reference them without a type error. */
export function redactCosts<T extends Record<string, unknown>>(
  role: Role,
  doc: T,
): T | Omit<T, CostField> {
  if (role === "owner") return doc;
  const copy: Record<string, unknown> = { ...doc };
  for (const field of COST_FIELDS) delete copy[field];
  return copy as Omit<T, CostField>;
}
