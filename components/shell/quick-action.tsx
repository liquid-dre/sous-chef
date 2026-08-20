"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { today } from "@/lib/day";
import { cn } from "@/lib/utils";
import {
  QuickSaleSheet,
  QUICK_ACTION_HREFS,
  type QuickSaleItem,
  type RecordedSale,
} from "./quick-sale-sheet";

/**
 * The floating quick action.
 *
 * It used to be a two-tap NAVIGATOR — tap, then follow a link to an empty
 * form. That is two taps to arrive and a whole form to fill, which for a
 * $1.50 scone at a market stall means the sale never gets logged. Now the
 * first tap opens the sheet and the second tap IS the sale: order, cost
 * snapshot and payment, written and closed.
 *
 * The only shell element permitted motion — sheet on mobile (240ms,
 * --ease-drawer via vaul), popover on desktop from its trigger origin. The
 * nav itself never animates.
 */

const triggerClass = cn(
  "flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float outline-none",
  "transition-transform duration-[var(--duration-fast)] ease-out active:scale-[0.97]",
  "focus-visible:ring-3 focus-visible:ring-ring/50",
);

export function QuickAction({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [recorded, setRecorded] = React.useState<RecordedSale | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Only fetched once the sheet has been opened — the chips are useless
  // until then and the shell is on every screen.
  const data = useQuery(api.orders.quickSaleItems, open ? { orgSlug } : "skip");
  const quickSale = useMutation(api.orders.quickSale);
  const setQuantity = useMutation(api.orders.setQuickSaleQuantity);
  const undo = useMutation(api.orders.undoQuickSale);

  const reset = () => {
    setRecorded(null);
    setError(null);
    setBusy(false);
  };
  const close = () => {
    setOpen(false);
    // After the sheet is gone, so the contents never flicker on the way out.
    window.setTimeout(reset, 200);
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  };

  const sheet = (compact?: boolean) => (
    <QuickSaleSheet
      orgSlug={orgSlug}
      items={data?.items}
      hasMenuItems={data?.hasMenuItems ?? false}
      recorded={recorded}
      busy={busy}
      error={error}
      compact={compact}
      onSell={(item: QuickSaleItem) =>
        guard(async () => {
          const result = await quickSale({
            orgSlug,
            menuItemId: item.id as Id<"menuItems">,
            day: today(),
          });
          setRecorded({
            orderId: result.orderId,
            itemName: result.itemName,
            qtyMilli: result.qtyMilli,
            totalCents: result.totalCents,
          });
        })
      }
      onSetQuantity={(n) =>
        guard(async () => {
          if (!recorded) return;
          const result = await setQuantity({
            orgSlug,
            orderId: recorded.orderId as Id<"orders">,
            qtyMilli: n * 1000,
          });
          setRecorded({ ...recorded, ...result });
        })
      }
      onUndo={() =>
        guard(async () => {
          if (!recorded) return;
          await undo({ orgSlug, orderId: recorded.orderId as Id<"orders"> });
          close();
        })
      }
      onDone={close}
    />
  );

  // Hidden on the screens it points AT — offering "log a sale" while she is
  // mid-sale is noise, and the button would sit on that screen's save bar.
  if (QUICK_ACTION_HREFS.some((href) => pathname?.endsWith(`/${href}`))) {
    return null;
  }

  return (
    <>
      {/* Mobile: sheet, within thumb reach, clear of the tab bar. */}
      <div className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 md:hidden">
        <Drawer
          open={open}
          onOpenChange={(next) => (next ? setOpen(true) : close())}
        >
          <DrawerTrigger className={triggerClass} aria-label="Quick actions">
            <Plus aria-hidden className="size-6" />
          </DrawerTrigger>
          <DrawerContent
            // Must open under 250ms; the global drawer token is 260ms, so
            // this instance overrides the var the vaul rule reads.
            style={{ "--duration-drawer": "240ms" } as React.CSSProperties}
          >
            <DrawerHeader>
              <DrawerTitle>Quick actions</DrawerTitle>
            </DrawerHeader>
            {sheet()}
          </DrawerContent>
        </Drawer>
      </div>

      {/* Desktop: popover scaling from its trigger origin. */}
      <div className="fixed right-6 bottom-6 z-40 hidden md:block">
        <Popover
          open={open}
          onOpenChange={(next) => (next ? setOpen(true) : close())}
        >
          <PopoverTrigger className={triggerClass} aria-label="Quick actions">
            <Plus aria-hidden className="size-6" />
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={10} className="w-80 p-2">
            {sheet(true)}
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
