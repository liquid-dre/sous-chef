"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ShoppingBasket } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { RouteLoading } from "@/components/route-loading";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useClientToday } from "@/components/use-client-today";
import { PantryDriftChart } from "./drift-charts";
import { DriftBadge } from "./drift-comparison";
import { ConfidenceNote } from "./confidence-note";
import {
  formatCountedAt,
  formatQty,
  formatSetAt,
  formatUnitPrice,
} from "./format";

/** The pantry list: every ingredient, its standard cost with the age of that
 * cost, and what has moved. Her word — never "inventory". */
export function PantryContainer({ orgSlug }: { orgSlug: string }) {
  // Her day, not the server's — whether the weekly count was missed is a
  // question about her week (lib/day.ts).
  const today = useClientToday();
  const data = useQuery(
    api.ingredients.list,
    today ? { orgSlug, today } : "skip",
  );
  if (data === undefined) return <RouteLoading />;

  if (data.rows.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBasket}
        title="The pantry is empty"
        body="Log a shop and the ingredients you bought appear here, costed and watched for price drift."
      />
    );
  }

  const attention = data.rows.filter((r) => r.needsAttention);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-display">Pantry</h1>
          <p className="type-body text-muted-foreground">
            {attention.length === 0
              ? "Everything is sitting on the cost you set for it."
              : `${attention.length} ${attention.length === 1 ? "ingredient has" : "ingredients have"} moved away from your costs.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={`/${orgSlug}/pantry/stocktake`}>Take a stocktake</Link>
          </Button>
          <Button asChild>
            <Link href={`/${orgSlug}/pantry/purchases/new`}>Log a shop</Link>
          </Button>
        </div>
      </div>

      {/* Stated before anything derived from it. CONTEXT.md: two missed
          stocktakes puts alerts dormant and the dashboard SAYS SO rather than
          quietly lying — a wrong red twice and she mutes Sous forever. */}
      <ConfidenceNote confidence={data.confidence} orgSlug={orgSlug} />

      <PantryDriftChart
        rows={data.rows
          .filter((r) => r.drift.percent !== null && !r.alertsMuted)
          .map((r) => ({
            name: r.name,
            percent: r.drift.percent!,
            severity: r.drift.severity,
          }))}
        anyDriftComputable={data.anyDriftComputable}
      />

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="px-4 py-2 text-left type-caption font-normal text-muted-foreground">
                Ingredient
              </th>
              <th className="px-4 py-2 text-right type-caption font-normal text-muted-foreground">
                Standard cost
              </th>
              <th className="hidden px-4 py-2 text-right type-caption font-normal text-muted-foreground sm:table-cell">
                In the pantry
              </th>
              <th className="px-4 py-2 text-right type-caption font-normal text-muted-foreground">
                Drift
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="px-4 py-2">
                  <Link
                    href={`/${orgSlug}/pantry/${row.id}`}
                    className="type-body underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right">
                  <span className="numeric-body">
                    {formatUnitPrice(
                      row.standardCostCentsPerThousand,
                      row.baseUnit,
                    )}
                  </span>
                  <span className="type-caption block text-muted-foreground">
                    {formatSetAt(row.standardCostSetAt)}
                  </span>
                </td>
                <td className="hidden px-4 py-2 text-right sm:table-cell">
                  {row.levelMilli !== null ? (
                    <>
                      <span className="numeric-sm">
                        {formatQty(row.levelMilli, row.baseUnit)}
                      </span>
                      {/* Staleness is part of the number (DESIGN.md §4). A
                          level whose age is not stated is a level she cannot
                          weigh, and this one is arithmetic, not a
                          measurement, until somebody counts it. */}
                      <span className="type-caption block text-muted-foreground">
                        {formatCountedAt(row.countedAt)}
                      </span>
                    </>
                  ) : (
                    <span className="type-caption text-muted-foreground">
                      not tracked
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <DriftBadge drift={row.drift} muted={row.alertsMuted} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
