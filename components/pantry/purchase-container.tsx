"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import { PurchaseEntryForm } from "./purchase-entry-form";
import type { BaseUnit, PackUnit } from "./format";

export function PurchaseContainer({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const today = useClientToday();
  // The whole pantry is the type-ahead source: small enough to hold, and it
  // means results appear on the first keystroke with no round trip.
  const pantry = useQuery(
    api.ingredients.list,
    today ? { orgSlug, today } : "skip",
  );
  const lastShop = useQuery(api.purchases.lastShop, { orgSlug });
  const createBatch = useMutation(api.purchases.createBatch);

  if (pantry === undefined || lastShop === undefined) return <RouteLoading />;

  return (
    <PurchaseEntryForm
      options={pantry.rows.map((r) => ({
        id: r.id,
        name: r.name,
        baseUnit: r.baseUnit as BaseUnit,
        standardCostCentsPerThousand: r.standardCostCentsPerThousand,
      }))}
      lastShop={
        lastShop && {
          purchasedAt: lastShop.purchasedAt,
          lineCount: lastShop.lineCount,
          totalCents: lastShop.totalCents,
          lines: lastShop.lines.map((l) => ({
            ingredientId: l.ingredientId,
            name: l.name,
            baseUnit: l.baseUnit as BaseUnit,
            packQtyMilli: l.packQtyMilli,
            packUnit: l.packUnit as PackUnit,
            priceCents: l.priceCents,
          })),
        }
      }
      onSave={async (lines) => {
        await createBatch({
          orgSlug,
          // HER day, so "no shop logged in 14 days" is measured against her
          // calendar rather than UTC.
          purchasedOn: today,
          lines: lines.map((l) => ({
            ...(l.ingredientId
              ? { ingredientId: l.ingredientId as Id<"ingredients"> }
              : {}),
            ...(l.newIngredient ? { newIngredient: l.newIngredient } : {}),
            packQtyMilli: l.packQtyMilli,
            packUnit: l.packUnit,
            priceCents: l.priceCents,
          })),
        });
        router.refresh();
      }}
    />
  );
}
