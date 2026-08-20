"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { TriangleAlert } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RouteLoading } from "@/components/route-loading";
import { Button } from "@/components/ui/button";
import {
  MenuBuilder,
  emptyDraft,
  type BuilderComponentOption,
  type BuilderDraft,
} from "./menu-builder";
import type { CostingWorld } from "@/convex/lib/costing";
import { ItemReadout } from "@/components/feedback/item-readout";
import type { Summary } from "@/convex/lib/feedback";

const HOURS_PER_DAY = 24;

/** While the readout query is in flight. Zero, not fabricated — the panel
 * renders its "nobody has said yet" state, which is also the honest answer
 * for a brand new item. */
const EMPTY_SUMMARY: Summary = {
  axes: [],
  n: 0,
  chefN: 0,
  flagCounts: { tooExpensive: 0, late: 0, packaging: 0, lovedIt: 0 },
  provenance: null,
};

export function BuilderContainer({
  orgSlug,
  menuItemId,
}: {
  orgSlug: string;
  menuItemId?: string;
}) {
  const router = useRouter();
  const [overrideBusy, setOverrideBusy] = React.useState(false);
  const setAside = useMutation(api.menuItems.setAsideOptimiser);
  const recordOverride = useMutation(api.optimiserOverrides.record);
  const undoOverride = useMutation(api.optimiserOverrides.undo);
  // A SECOND query, deliberately: the builder is the screen she opens to
  // change a recipe, and it must not wait on a feedback aggregation to render
  // the form.
  const readout = useQuery(
    api.feedback.forMenuItem,
    menuItemId ? { orgSlug, menuItemId: menuItemId as Id<"menuItems"> } : "skip",
  );
  const data = useQuery(api.menuItems.getForBuilder, {
    orgSlug,
    ...(menuItemId ? { menuItemId: menuItemId as Id<"menuItems"> } : {}),
  });
  const save = useMutation(api.menuItems.save);
  const remove = useMutation(api.menuItems.remove);
  const [saving, setSaving] = React.useState(false);

  if (data === undefined) return <RouteLoading />;

  const world: CostingWorld = {
    items: data.world.items,
    ingredients: data.world.ingredients,
    overheadRateCentsPerHour: data.world.overheadRateCentsPerHour,
  };

  const initial: BuilderDraft = data.item
    ? {
        name: data.item.name,
        notSoldDirectly: data.item.notSoldDirectly,
        baseBatchYield: data.item.baseBatchYield,
        unitWeightMilligrams: data.item.unitWeightMilligrams,
        batchProductionMinutes: data.item.batchProductionMinutes,
        perUnitExtras: data.item.perUnitExtras,
        priceCents: data.item.priceCents,
        targetGrossMarginPercent: data.item.targetGrossMarginPercent,
        minPriceCents: data.item.minPriceCents,
        maxPriceCents: data.item.maxPriceCents,
        minYield: data.item.minYield,
        maxYield: data.item.maxYield,
        unitWeightFloorMilligrams: data.item.unitWeightFloorMilligrams,
        constraintNote: data.item.constraintNote,
        leadTimeHours: data.item.leadTimeHours,
        sensoryAxes: data.item.sensoryAxes,
        shelfLifeDays:
          data.item.shelfLifeHours == null
            ? null
            : Math.round(data.item.shelfLifeHours / HOURS_PER_DAY),
        lines: data.item.lines.map((l, i) => ({
          key: `saved-${i}`,
          componentType: l.componentType,
          componentId: l.componentId,
          qtyMilli: l.qtyMilli,
        })),
      }
    : emptyDraft();

  const wouldLoop = new Set(data.wouldLoop);
  const options: BuilderComponentOption[] = [
    ...Object.values(data.world.ingredients).map((i) => ({
      id: i.id,
      name: i.name,
      kind: "ingredient" as const,
      baseUnit: i.baseUnit,
    })),
    ...Object.values(data.world.items).map((m) => ({
      id: m.id,
      name: m.name,
      kind: "menuItem" as const,
      wouldLoop: wouldLoop.has(m.id),
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  // Which drifted ingredients this item actually touches.
  const driftedNames = Object.entries(data.drifts)
    .filter(([, d]) => d.drifted)
    .map(([id]) => data.world.ingredients[id]?.name)
    .filter(Boolean);

  return (
    <MenuBuilder
      initial={initial}
      world={world}
      options={options}
      saving={saving}
      feedbackWarnings={data.feedbackWarnings}
      portionEvidence={data.portionEvidence}
      overriddenYields={data.overriddenYields}
      overrideReport={data.overrideReport}
      overrideBusy={overrideBusy}
      onOverride={
        menuItemId && data.item
          ? async () => {
              setOverrideBusy(true);
              try {
                await recordOverride({
                  orgSlug,
                  menuItemId: menuItemId as Id<"menuItems">,
                  yieldUnits: data.item!.baseBatchYield,
                });
              } finally {
                setOverrideBusy(false);
              }
            }
          : undefined
      }
      onUndoOverride={
        menuItemId && data.item
          ? async () => {
              setOverrideBusy(true);
              try {
                await undoOverride({
                  orgSlug,
                  menuItemId: menuItemId as Id<"menuItems">,
                  yieldUnits: data.item!.baseBatchYield,
                });
              } finally {
                setOverrideBusy(false);
              }
            }
          : undefined
      }
      /* Unwired since 1.3: the mutation and the UI both existed and nothing
         joined them, so the affordance has never rendered in production. */
      setAsideAt={data.item?.optimiserSetAsideAt ?? null}
      setAsideMarginPercent={data.item?.optimiserSetAsideMarginPercent ?? null}
      onSetAside={
        menuItemId
          ? (marginPercent) =>
              void setAside({
                orgSlug,
                menuItemId: menuItemId as Id<"menuItems">,
                marginPercent,
              })
          : undefined
      }
      onRestore={
        menuItemId
          ? () =>
              void setAside({
                orgSlug,
                menuItemId: menuItemId as Id<"menuItems">,
                marginPercent: null,
              })
          : undefined
      }
      readout={
        menuItemId ? (
          <ItemReadout
            itemName={data.item?.name ?? "this"}
            data={{
              axes: data.item?.sensoryAxes ?? [],
              summary: readout?.summary ?? EMPTY_SUMMARY,
              comments: readout?.comments ?? [],
            }}
          />
        ) : null
      }
      driftNotice={
        driftedNames.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-warn-soft p-3">
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn-foreground" />
            <p className="type-label min-w-40 flex-1 text-warn-foreground">
              {driftedNames.join(", ")} {driftedNames.length === 1 ? "has" : "have"}{" "}
              moved away from the cost you set. This costing still uses your
              standard costs.
            </p>
            <Button variant="outline" size="sm" asChild>
              <a href={`/${orgSlug}/pantry`}>Review in the pantry</a>
            </Button>
          </div>
        ) : undefined
      }
      onSave={async (draft) => {
        setSaving(true);
        try {
          const { menuItemId: savedId } = await save({
            orgSlug,
            ...(menuItemId ? { menuItemId: menuItemId as Id<"menuItems"> } : {}),
            name: draft.name,
            notSoldDirectly: draft.notSoldDirectly,
            baseBatchYield: draft.baseBatchYield,
            unitWeightMilligrams: draft.unitWeightMilligrams,
            batchProductionMinutes: draft.batchProductionMinutes,
            perUnitExtras: draft.perUnitExtras,
            priceCents: draft.priceCents,
            targetGrossMarginPercent: draft.targetGrossMarginPercent,
            minPriceCents: draft.minPriceCents,
            maxPriceCents: draft.maxPriceCents,
            minYield: draft.minYield,
            maxYield: draft.maxYield,
            unitWeightFloorMilligrams: draft.unitWeightFloorMilligrams,
            constraintNote: draft.constraintNote,
            leadTimeHours: draft.leadTimeHours,
            sensoryAxes: draft.sensoryAxes,
            shelfLifeHours:
              draft.shelfLifeDays == null
                ? null
                : draft.shelfLifeDays * HOURS_PER_DAY,
            lines: draft.lines
              .filter((l) => l.qtyMilli > 0)
              .map((l) => ({
                componentType: l.componentType,
                componentId: l.componentId,
                qtyMilli: l.qtyMilli,
                unit:
                  l.componentType === "menuItem"
                    ? ("unit" as const)
                    : (data.world.ingredients[l.componentId]?.baseUnit ?? "g"),
              })),
          });
          router.push(`/${orgSlug}/menu/${savedId}`);
        } finally {
          setSaving(false);
        }
      }}
      onDelete={
        menuItemId
          ? async () => {
              await remove({
                orgSlug,
                menuItemId: menuItemId as Id<"menuItems">,
              });
              router.push(`/${orgSlug}/menu`);
            }
          : undefined
      }
    />
  );
}
