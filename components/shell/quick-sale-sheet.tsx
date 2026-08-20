"use client";

import * as React from "react";
import Link from "next/link";
import { Check, CookingPot, NotebookPen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DrawerClose, DrawerTitle } from "@/components/ui/drawer";
import { formatMoney } from "@/components/numeric/money";
import { cn } from "@/lib/utils";

/**
 * The contents of the quick action, on both mobile and desktop.
 *
 * The whole point is the tap count. Tap one opens this; tap two is a chip,
 * and the sale is *recorded* — not a form opened, not a screen navigated to.
 * A market stall sale that costs three taps is a sale that does not get
 * logged, and an unlogged sale reads as a fake loss.
 *
 * Quantity is deliberately not a step. One is what she sells almost every
 * time, so it is the default, and ×2 / ×3 live on the confirmation where
 * they cost a tap only when they are actually needed.
 */

export interface QuickSaleItem {
  id: string;
  name: string;
  priceCents: number;
}

export interface RecordedSale {
  orderId: string;
  itemName: string;
  qtyMilli: number;
  totalCents: number;
}

const ACTIONS = [
  {
    href: "orders/new",
    icon: NotebookPen,
    label: "Log a full order",
    caption: "A customer, a date, several items.",
  },
  {
    href: "production/new",
    icon: CookingPot,
    label: "Log production",
    caption: "What was actually made, actual yield.",
  },
] as const;

export function QuickSaleSheet({
  orgSlug,
  items,
  hasMenuItems,
  recorded,
  busy,
  error,
  onSell,
  onSetQuantity,
  onUndo,
  onDone,
  compact,
}: {
  orgSlug: string;
  items: QuickSaleItem[] | undefined;
  hasMenuItems: boolean;
  /** Non-null once a sale has been recorded — this sheet becomes its receipt. */
  recorded: RecordedSale | null;
  busy?: boolean;
  error?: string | null;
  onSell: (item: QuickSaleItem) => void;
  onSetQuantity: (qty: number) => void;
  onUndo: () => void;
  onDone: () => void;
  /** Desktop popover: tighter rows, no safe-area padding. */
  compact?: boolean;
}) {
  if (recorded) {
    const units = recorded.qtyMilli / 1000;
    return (
      <div
        className={cn(
          "flex flex-col gap-3",
          compact ? "p-2" : "p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
        )}
      >
        <div className="flex items-center gap-2">
          <Check aria-hidden className="size-5 shrink-0 text-profit" />
          <p className="type-body font-medium">
            {units > 1 ? `${units} × ` : ""}
            {recorded.itemName} ·{" "}
            <span className="numeric">
              {formatMoney(recorded.totalCents / 100)}
            </span>{" "}
            in
          </p>
        </div>
        <p className="type-caption text-muted-foreground">
          Recorded and paid. Nothing else to do.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {[2, 3].map((n) => (
            <Button
              key={n}
              variant="outline"
              size="sm"
              disabled={busy || units === n}
              onClick={() => onSetQuantity(n)}
            >
              ×{n}
            </Button>
          ))}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onUndo}>
            Undo
          </Button>
          <Button size="sm" className="ml-auto" onClick={onDone}>
            Done
          </Button>
        </div>
        {error && (
          <p
            className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        compact ? "p-2" : "p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
      )}
    >
      <div className="flex flex-col gap-2">
        <span className="type-label text-muted-foreground">Sold something?</span>
        {items === undefined ? (
          <p className="type-caption text-muted-foreground">Loading your menu…</p>
        ) : items.length === 0 ? (
          <p className="type-caption text-muted-foreground">
            {hasMenuItems
              ? "Nothing on your menu has a price yet, so there's nothing to ring up."
              : "Once your menu has something on it, selling it is one tap."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Sell one">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                aria-label={`Sell one ${item.name} for ${formatMoney(item.priceCents / 100)}`}
                onClick={() => onSell(item)}
                className="flex min-h-11 items-center gap-2 rounded-full border bg-card px-3 type-label outline-none transition-[background-color,transform] duration-[var(--duration-fast)] ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] disabled:opacity-50 md:min-h-9"
              >
                {item.name}
                <span className="numeric-sm text-muted-foreground">
                  {formatMoney(item.priceCents / 100)}
                </span>
              </button>
            ))}
          </div>
        )}
        {error && (
          <p
            className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t pt-3">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          const row = (
            <Link
              href={`/${orgSlug}/${action.href}`}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                compact ? "min-h-11 py-1.5" : "min-h-14",
              )}
            >
              <Icon aria-hidden className="size-5 shrink-0 text-primary" strokeWidth={1.8} />
              <span className="flex flex-col">
                <span className="type-body font-medium">{action.label}</span>
                <span className="type-caption text-muted-foreground">
                  {action.caption}
                </span>
              </span>
            </Link>
          );
          return compact ? (
            <React.Fragment key={action.href}>{row}</React.Fragment>
          ) : (
            <DrawerClose asChild key={action.href}>
              {row}
            </DrawerClose>
          );
        })}
      </div>
    </div>
  );
}

/** Shared so the drawer and the popover cannot drift. */
export function QuickSaleHeading() {
  return <DrawerTitle>Quick actions</DrawerTitle>;
}

export const QUICK_ACTION_HREFS = ACTIONS.map((a) => a.href);
export { Plus as QuickActionIcon };
