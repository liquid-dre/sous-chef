"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { UtensilsCrossed } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { RouteLoading } from "@/components/route-loading";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatMoneyExact } from "@/components/charts-sous/format";
import { cn } from "@/lib/utils";

export function MenuListContainer({ orgSlug }: { orgSlug: string }) {
  const data = useQuery(api.menuItems.list, { orgSlug });
  if (data === undefined) return <RouteLoading />;

  if (data.rows.length === 0) {
    return (
      <EmptyState
        icon={UtensilsCrossed}
        title="Your menu starts empty"
        body="Each menu item is a recipe, a price and a target margin in one place — sub-recipes included, nested as deep as your buttercream goes."
        actionLabel="Add your first menu item"
      />
    );
  }

  const sold = data.rows.filter((r) => !r.notSoldDirectly);
  const subs = data.rows.filter((r) => r.notSoldDirectly);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-display">Menu</h1>
          <p className="type-body text-muted-foreground">
            Recipe, price and margin — one thing, not three.
          </p>
        </div>
        <Button asChild>
          <Link href={`/${orgSlug}/menu/new`}>Add a menu item</Link>
        </Button>
      </div>

      <Group orgSlug={orgSlug} title="What you sell" rows={sold} />
      {subs.length > 0 && (
        <Group
          orgSlug={orgSlug}
          title="Sub-recipes"
          caption="Used inside other items; they carry cost, not margin."
          rows={subs}
        />
      )}
    </div>
  );
}

function Group({
  orgSlug,
  title,
  caption,
  rows,
}: {
  orgSlug: string;
  title: string;
  caption?: string;
  rows: {
    id: string;
    name: string;
    priceCents: number | null;
    totalCentsPerUnit: number;
    grossMarginPercent: number | null;
    targetGrossMarginPercent: number | null;
    belowTarget: boolean;
  }[];
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div>
        <h2 className="type-title">{title}</h2>
        {caption && (
          <p className="type-caption text-muted-foreground">{caption}</p>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              {["Item", "Costs", "Price", "Gross margin"].map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    "px-4 py-2 type-caption font-normal text-muted-foreground",
                    i === 0 ? "text-left" : "text-right",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="px-4 py-2">
                  <Link
                    href={`/${orgSlug}/menu/${row.id}`}
                    className="type-body underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="numeric-sm px-4 py-2 text-right">
                  {formatMoneyExact(Math.round(row.totalCentsPerUnit))}
                </td>
                <td className="numeric-sm px-4 py-2 text-right">
                  {row.priceCents == null
                    ? "—"
                    : formatMoneyExact(row.priceCents)}
                </td>
                <td className="px-4 py-2 text-right">
                  {row.grossMarginPercent == null ? (
                    <span className="type-caption text-muted-foreground">—</span>
                  ) : (
                    <span
                      className={cn(
                        "numeric-body",
                        row.belowTarget && "text-loss",
                      )}
                    >
                      {row.grossMarginPercent}%
                      {row.targetGrossMarginPercent != null && (
                        <span className="type-caption ml-1 text-muted-foreground">
                          / {row.targetGrossMarginPercent}%
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
