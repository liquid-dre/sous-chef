"use client";

import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { PLAN_LABEL, type AdminOrgRow } from "./types";

/**
 * Every kitchen, in one list.
 *
 * A real table on desktop and a card list below `md`. Not a horizontally
 * scrolling table: eight columns on a 380px screen is a table nobody reads,
 * and the honest mobile answer is one card per kitchen with the two figures
 * that matter on their own line.
 *
 * Order comes from Clerk, newest first. Sorting is deliberately absent — with
 * one pilot kitchen it would be chrome, and a sort control that exists to be
 * demonstrated rather than used is decoration.
 */
export function OrgTable({
  rows,
  onOpen,
}: {
  rows: AdminOrgRow[];
  onOpen: (row: AdminOrgRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No kitchens yet"
        body="Provision the first one above. Sous creates the organisation, emails the chef an invitation, and records her settings — there is no self-signup."
      />
    );
  }

  return (
    <>
      {/* Mobile */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li key={row.orgId}>
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="flex w-full flex-col gap-2 rounded-lg border bg-card px-4 py-3 text-left transition-[border-color] duration-[var(--duration-fast)] ease-out focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="type-label">{row.name}</span>
                <StateChip row={row} />
              </div>
              <span className="type-caption text-muted-foreground">
                /{row.slug}
              </span>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <Figure label="Orders this month" value={row.ordersThisMonth} />
                <Figure label="Users" value={row.membersCount} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kitchen</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.orgId}>
                <TableCell>
                  <span className="block">{row.name}</span>
                  <span className="type-caption text-muted-foreground">
                    /{row.slug}
                  </span>
                </TableCell>
                <TableCell>
                  {row.plan ? (
                    <span className="type-body">
                      {PLAN_LABEL[row.plan]}
                      {row.foundingMember && (
                        <span className="type-caption text-muted-foreground">
                          {" "}
                          · founding
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="type-caption text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="numeric-sm text-muted-foreground">
                  {new Date(row.createdAt).toLocaleDateString("en-US", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </TableCell>
                {/* Counts are numbers she compares down a column, so tabular
                    figures and right alignment (DESIGN.md §4). */}
                <TableCell className="numeric text-right">
                  {row.ordersThisMonth}
                </TableCell>
                <TableCell className="numeric text-right">
                  {row.membersCount}
                </TableCell>
                <TableCell>
                  <StateChip row={row} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpen(row)}
                  >
                    Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex flex-col">
      <span className="numeric-lg">{value}</span>
      <span className="type-caption text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * Three states, and only two of them are worth colour.
 *
 * "Live" gets none — it is the ordinary case, and a green chip on every row
 * is noise that makes the two rows that need attention harder to find.
 */
function StateChip({ row }: { row: AdminOrgRow }) {
  if (!row.provisioned) {
    return (
      <span className="type-caption rounded-full bg-warn-soft px-2 py-0.5 text-warn-foreground">
        not provisioned
      </span>
    );
  }
  if (row.disabled) {
    return (
      <span className="type-caption rounded-full bg-loss-soft px-2 py-0.5 text-loss-foreground">
        read-only
      </span>
    );
  }
  return (
    <span className={cn("type-caption text-muted-foreground")}>Live</span>
  );
}
