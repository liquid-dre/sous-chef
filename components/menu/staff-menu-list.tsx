"use client";

import { useQuery } from "convex/react";
import { UtensilsCrossed } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { RouteLoading } from "@/components/route-loading";
import { EmptyState } from "@/components/empty-state";
import { formatMoneyExact } from "@/components/charts-sous/format";

/**
 * The menu for staff: what things are and what they sell for. No costs, no
 * margins — not hidden, never fetched (convex/menuItems.ts listForKitchen).
 */
export function StaffMenuList({ orgSlug }: { orgSlug: string }) {
  const rows = useQuery(api.menuItems.listForKitchen, { orgSlug });
  if (rows === undefined) return <RouteLoading />;

  const sold = rows.filter((r) => !r.notSoldDirectly);
  if (sold.length === 0) {
    return (
      <EmptyState
        icon={UtensilsCrossed}
        title="Nothing on the menu yet"
        body="Once the kitchen adds items they appear here, with what each one sells for."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="type-display">Menu</h1>
        <p className="type-body text-muted-foreground">
          What we make, and what it sells for.
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {sold.map((row) => (
          <li
            key={row.id}
            className="flex min-h-12 items-center justify-between gap-4 px-4 py-2"
          >
            <span className="type-body">{row.name}</span>
            <span className="numeric-body">
              {row.priceCents == null ? "—" : formatMoneyExact(row.priceCents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
