"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, ShoppingBasket } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { EmptyState } from "@/components/empty-state";
import { useClientToday } from "@/components/use-client-today";
import { StocktakeForm, type StocktakeRow } from "./stocktake-form";
import type { BaseUnit } from "./format";

export function StocktakeContainer({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  // HER day. A count taken at 22:00 in Harare belongs to that day, not to
  // tomorrow, and whether the weekly count was missed is a question about
  // her week (lib/day.ts).
  const today = useClientToday();
  const data = useQuery(
    api.ingredients.list,
    today ? { orgSlug, today } : "skip",
  );
  const record = useMutation(api.stock.recordStocktake);

  if (data === undefined) return <RouteLoading />;

  // Salt, water, foil are costed and never counted (CONTEXT.md — Pantry), so
  // they are not on the list at all rather than listed and disabled.
  const rows: StocktakeRow[] = data.rows
    .filter((r) => r.levelMilli !== null)
    .map((r) => ({
      id: r.id,
      name: r.name,
      baseUnit: r.baseUnit as BaseUnit,
      expectedMilli: r.levelMilli!,
      countedAt: r.countedAt,
    }));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBasket}
        title="Nothing to count yet"
        body="Log a shop and the ingredients you keep a running amount of appear here to be counted."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/${orgSlug}/pantry`}
        className="type-caption inline-flex w-fit items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
        Pantry
      </Link>
      <StocktakeForm
        rows={rows}
        saving={saving}
        onSave={async (lines) => {
          setSaving(true);
          try {
            await record({
              orgSlug,
              takenOn: today,
              lines: lines.map((l) => ({
                ingredientId: l.ingredientId as Id<"ingredients">,
                countedQtyMilli: l.countedQtyMilli,
              })),
            });
            router.push(`/${orgSlug}/pantry`);
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}
