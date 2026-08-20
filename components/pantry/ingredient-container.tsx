"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AdoptMedianDialog } from "./adopt-median-dialog";
import { PriceHistoryChart } from "./drift-charts";
import { DriftComparison } from "./drift-comparison";
import { Ledger } from "./ledger";
import { MovementDialogs } from "./movement-dialogs";
import {
  formatCountedAt,
  formatPack,
  formatQty,
  formatSetAt,
  formatUnitPrice,
} from "./format";
import { formatMoneyExact } from "@/components/charts-sous/format";

export function IngredientContainer({
  orgSlug,
  ingredientId,
}: {
  orgSlug: string;
  ingredientId: string;
}) {
  const data = useQuery(api.ingredients.get, {
    orgSlug,
    ingredientId: ingredientId as Id<"ingredients">,
  });
  const ledger = useQuery(api.stock.ledgerFor, {
    orgSlug,
    ingredientId: ingredientId as Id<"ingredients">,
  });
  const adoptMedian = useMutation(api.ingredients.adoptMedian);
  const update = useMutation(api.ingredients.update);

  if (data === undefined) return <RouteLoading />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/${orgSlug}/pantry`}
          className="type-caption inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          Pantry
        </Link>
        <h1 className="type-display mt-1">{data.name}</h1>
        <p className="type-body text-muted-foreground">
          Costed at{" "}
          <span className="numeric">
            {formatUnitPrice(data.standardCostCentsPerThousand, data.baseUnit)}
          </span>{" "}
          · {formatSetAt(data.standardCostSetAt)}
        </p>
        {/* Staleness is part of the number (DESIGN.md §4). The amount on hand
            is arithmetic until somebody counts it, and the age of that count
            travels with it everywhere it renders. */}
        {data.levelMilli !== null && (
          <p className="type-body text-muted-foreground">
            <span className="numeric">
              {formatQty(data.levelMilli, data.baseUnit)}
            </span>{" "}
            on hand · {formatCountedAt(data.countedAt)}
          </p>
        )}
      </div>

      {data.levelMilli !== null && (
        <MovementDialogs
          orgSlug={orgSlug}
          ingredientId={ingredientId as Id<"ingredients">}
          name={data.name}
          baseUnit={data.baseUnit}
        />
      )}

      <section
        aria-label="Cost drift"
        className="flex flex-col gap-4 rounded-lg border bg-card p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="type-title">Against your standard cost</h2>
          {data.drift.hasEnoughData &&
            data.drift.drifted &&
            data.drift.medianCentsPerThousand !== null && (
              <AdoptMedianDialog
                name={data.name}
                baseUnit={data.baseUnit}
                standardCentsPerThousand={data.standardCostCentsPerThousand}
                medianCentsPerThousand={data.drift.medianCentsPerThousand}
                percent={data.drift.percent!}
                onAdopt={async () => {
                  await adoptMedian({
                    orgSlug,
                    ingredientId: ingredientId as Id<"ingredients">,
                  });
                }}
              />
            )}
        </div>
        <DriftComparison
          baseUnit={data.baseUnit}
          standardSetAt={data.standardCostSetAt}
          drift={data.drift}
        />
      </section>

      <PriceHistoryChart
        name={data.name}
        baseUnit={data.baseUnit}
        standardCentsPerThousand={data.standardCostCentsPerThousand}
        history={data.history}
      />

      {/* The breakdown behind the amount on hand. A derived number with no
          breakdown affordance is a defect (DESIGN.md §4), and this is the
          largest derived number in Sous. */}
      {ledger !== undefined && ledger.levelMilli !== null && (
        <Ledger
          rows={ledger.rows}
          baseUnit={ledger.baseUnit}
          levelMilli={ledger.levelMilli}
          countedAt={ledger.countedAt}
        />
      )}

      <section
        aria-label="Purchases"
        className="flex flex-col gap-3 rounded-lg border bg-card p-5"
      >
        <h2 className="type-title">Purchases</h2>
        {data.history.length === 0 ? (
          <p className="type-body text-muted-foreground">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {[...data.history].reverse().map((h, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between gap-4 py-2"
              >
                <span className="type-body">
                  {formatPack(h.packQtyMilli, h.packUnit)}
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="numeric-sm text-muted-foreground">
                    {formatUnitPrice(h.unitPriceCentsPerThousand, data.baseUnit)}
                  </span>
                  <span className="numeric-body">
                    {formatMoneyExact(h.priceCents)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label="Settings"
        className="flex flex-col gap-4 rounded-lg border bg-card p-5"
      >
        <h2 className="type-title">How Sous treats it</h2>
        <div className="flex items-center gap-2.5">
          <Switch
            id="track-stock"
            checked={data.trackStock}
            onCheckedChange={(v) =>
              update({
                orgSlug,
                ingredientId: ingredientId as Id<"ingredients">,
                trackStock: v,
              })
            }
          />
          <Label htmlFor="track-stock">
            Keep a running amount
            {data.levelMilli !== null && (
              <span className="type-caption ml-2 text-muted-foreground">
                {formatQty(data.levelMilli, data.baseUnit)} on hand
              </span>
            )}
          </Label>
        </div>
        <div className="flex items-center gap-2.5">
          <Switch
            id="alerts"
            checked={!data.alertsMuted}
            onCheckedChange={(v) =>
              update({
                orgSlug,
                ingredientId: ingredientId as Id<"ingredients">,
                alertsMuted: !v,
              })
            }
          />
          <Label htmlFor="alerts">
            Tell me when this drifts
            <span className="type-caption ml-2 text-muted-foreground">
              costing is unaffected either way
            </span>
          </Label>
        </div>
      </section>
    </div>
  );
}
