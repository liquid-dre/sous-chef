"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { useClientToday } from "@/components/use-client-today";
import {
  PeriodProvider,
  PeriodSwitcher,
  usePeriod,
} from "@/components/charts-sous/use-period";
import { RecommendationCard, type CardRow } from "./recommendation-card";

/**
 * Everything Sous has to suggest, in one ranked list.
 *
 * She was never going to open twelve menu items to find out which one needs
 * attention. The order on the screen is the argument: the shape of the
 * problem, then the problems themselves biggest first, then the things worth
 * a look that have no dollar figure at all.
 *
 * The chart is dynamically imported — its JavaScript is off the critical path,
 * and the list, which is the thing she came for, renders without it.
 */

const ImpactBars = dynamic(
  () => import("./impact-bars").then((m) => m.ImpactBars),
  {
    ssr: false,
    loading: () => <div className="h-64 animate-pulse rounded-lg border bg-card" />,
  },
);

/**
 * Below this the chart is not rendered at all: a table of contents for one
 * entry IS the entry, and the card beneath already says everything the bar
 * would. Declared here rather than imported from ./impact-bars so that reading
 * it does not drag the chart's module into the main bundle — which is the
 * whole point of the dynamic import above.
 */
const MIN_ROWS_FOR_BARS = 2;

export function RecommendationsContainer({ orgSlug }: { orgSlug: string }) {
  return (
    <PeriodProvider defaultPeriod="month">
      <Inner orgSlug={orgSlug} />
    </PeriodProvider>
  );
}

function Inner({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const today = useClientToday();
  const { bounds, label } = usePeriod();
  const [busy, setBusy] = React.useState<string | null>(null);
  /** The row on its way out, for the 200ms before the mutation lands. */
  const [leaving, setLeaving] = React.useState<string | null>(null);

  const data = useQuery(
    api.recommendations.list,
    today ? { orgSlug, start: bounds.start, end: bounds.end } : "skip",
  );
  const dismiss = useMutation(api.recommendations.dismiss);
  const restore = useMutation(api.recommendations.restore);
  const adoptMedian = useMutation(api.ingredients.adoptMedian);

  const onDismiss = async (row: CardRow) => {
    setBusy(row.subjectKey);
    // Let the row animate out BEFORE the mutation, rather than letting the
    // query update blink it away. Matches the card's own 200ms.
    setLeaving(row.subjectKey);
    await new Promise((r) => setTimeout(r, 200));
    try {
      await dismiss({
        orgSlug,
        subjectKey: row.subjectKey,
        cents: row.cents,
        causeKinds: row.causes.map((c) => c.kind),
      });
      // The figure, not "dismissed": what comes back later is decided by it,
      // and she should know that is what was written down.
      toast.success(`Set aside at ${formatShort(row.cents)}`, {
        description: "It comes back if it moves much, or if something new goes wrong with it.",
        action: {
          label: "Undo",
          onClick: () => void restore({ orgSlug, subjectKey: row.subjectKey }),
        },
      });
    } catch (error) {
      toast.error(message(error));
      // It is staying after all, so it has to come back rather than sit
      // invisible where she left it.
      setLeaving(null);
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async (row: CardRow) => {
    setBusy(row.subjectKey);
    try {
      await restore({ orgSlug, subjectKey: row.subjectKey });
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(null);
    }
  };

  const onAct = async (row: CardRow) => {
    if (row.action.kind !== "adoptMedian" || !row.action.targetId) {
      router.push(row.action.href);
      return;
    }
    setBusy(row.subjectKey);
    try {
      const { adoptedCentsPerThousand } = await adoptMedian({
        orgSlug,
        ingredientId: row.action.targetId as Id<"ingredients">,
      });
      toast.success(`${row.subjectName} re-costed`, {
        description: `Now ${formatShort(adoptedCentsPerThousand)} per 1000. Orders you've already taken keep the cost they were stamped with.`,
      });
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link href={`/${orgSlug}`}>
          <ArrowLeft aria-hidden /> Home
        </Link>
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-display-sm">What to fix</h1>
        <PeriodSwitcher />
      </div>
    </div>
  );

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {header}
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  if (!data.hasAnyItem) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {header}
        <EmptyState
          icon={Sparkles}
          title="Nothing to suggest yet"
          body="Cost a menu item and take a few orders, and anything worth fixing turns up here."
          actionLabel="Add a menu item"
          actionHref={`/${orgSlug}/menu/new`}
        />
      </div>
    );
  }

  const rows = data.live as CardRow[];
  const dismissed = data.dismissed as CardRow[];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {header}

      {rows.length === 0 ? (
        /* Reassurance, which means naming what was CHECKED. "No
           recommendations" reads as absence — as though Sous had not looked. */
        <section className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center">
          <CircleCheck aria-hidden className="size-6 text-profit" strokeWidth={1.5} />
          <h2 className="type-display-sm text-balance">Nothing is leaking</h2>
          <p className="type-body max-w-md text-pretty text-muted-foreground">
            Every item is at or above the margin you set for it, no ingredient
            has moved past your cost threshold, nothing was baked and not sold,
            and every delivery covered its own fuel.
          </p>
          <p className="type-caption text-muted-foreground">
            Checked against {label.toLowerCase()}.
          </p>
        </section>
      ) : (
        <>
          {rows.length >= MIN_ROWS_FOR_BARS && (
            <ImpactBars
              rows={rows.map((r) => ({ name: r.subjectName, cents: r.cents }))}
              periodLabel={label}
            />
          )}

          <section aria-label="Recommendations" className="flex flex-col gap-3">
            {rows.map((row, i) => (
              <RecommendationCard
                key={row.subjectKey}
                row={row}
                rank={i + 1}
                busy={busy === row.subjectKey}
                leaving={leaving === row.subjectKey}
                onAct={row.action.kind === "adoptMedian" ? () => void onAct(row) : undefined}
                onDismiss={() => void onDismiss(row)}
              />
            ))}
          </section>
        </>
      )}

      {data.optimiserCapped > 0 && (
        /* Said out loud. A cap that stays silent reads as "every item was
           checked", which would be a lie about the one thing this screen is
           for. */
        <p className="type-caption text-muted-foreground">
          {data.optimiserCapped} more{" "}
          {data.optimiserCapped === 1 ? "item is" : "items are"} below the margin
          you set for {data.optimiserCapped === 1 ? "it" : "them"}, by smaller
          amounts than these. Sous worked out the twenty biggest; the rest are on{" "}
          <Link href={`/${orgSlug}/menu`} className="underline underline-offset-4">
            the menu
          </Link>
          .
        </p>
      )}

      {data.stale.length > 0 && (
        /* Outside the ranking and off the chart, because staleness has no
           honest dollar figure of its own. Inventing one so it could be ranked
           would break "ranked by dollar impact" far worse than this does. */
        <section className="flex flex-col gap-2 border-t pt-4">
          <h2 className="type-label text-muted-foreground">Worth a look</h2>
          <p className="type-body text-muted-foreground">
            {data.stale.length}{" "}
            {data.stale.length === 1 ? "item was" : "items were"} priced more
            than 90 days ago. Nothing says the prices are wrong — only that
            nothing has checked them against what things cost now.
          </p>
          <ul className="flex flex-wrap gap-2">
            {data.stale.map((item) => (
              <li key={item.menuItemId}>
                <Button variant="outline" size="sm" asChild>
                  <Link href={item.href}>
                    {item.name} <span className="text-muted-foreground">{item.days}d</span>
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dismissed.length > 0 && (
        <details className="flex flex-col gap-2 border-t pt-4">
          <summary className="type-label min-h-11 cursor-pointer text-muted-foreground marker:text-muted-foreground">
            Set aside ({dismissed.length})
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {dismissed.map((row) => (
              <RecommendationCard
                key={row.subjectKey}
                row={row}
                busy={busy === row.subjectKey}
                onRestore={() => void onRestore(row)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function formatShort(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "That didn't save.";
}
