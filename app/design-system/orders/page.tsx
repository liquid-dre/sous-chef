"use client";

import * as React from "react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderForm, type MenuOption } from "@/components/orders/order-form";
import { SavedOrderView } from "@/components/orders/saved-order-view";
import type { CustomerOption } from "@/components/orders/customer-typeahead";
import { OrdersList, type OrderRow, type OrdersFilter } from "@/components/orders/orders-list";
import {
  QuickSaleSheet,
  type RecordedSale,
} from "@/components/shell/quick-sale-sheet";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Order flow specimen — the grading surface, and where the tap budget is
 * counted. Mounts the real form with sample data so the whole sequence is
 * reviewable without a Clerk session.
 */

const MENU: MenuOption[] = [
  {
    id: "brownie",
    name: "Brownies",
    notSoldDirectly: false,
    priceCents: 300,
    leadTimeHours: 48,
    variableCentsPerUnit: 35,
    overheadCentsPerUnit: 71,
  },
  {
    id: "cake",
    name: "Celebration cake",
    notSoldDirectly: false,
    priceCents: 3200,
    leadTimeHours: 72,
    variableCentsPerUnit: 213,
    overheadCentsPerUnit: 2000,
  },
  {
    id: "sourdough",
    name: "Sourdough loaf",
    notSoldDirectly: false,
    priceCents: 850,
    leadTimeHours: 24,
    variableCentsPerUnit: 92,
    overheadCentsPerUnit: 600,
  },
  {
    id: "scones",
    name: "Scones",
    notSoldDirectly: false,
    priceCents: 150,
    leadTimeHours: null,
    variableCentsPerUnit: 40,
    overheadCentsPerUnit: 30,
  },
  {
    id: "buttercream",
    name: "Buttercream",
    notSoldDirectly: true,
    priceCents: null,
    leadTimeHours: null,
  },
];

const CUSTOMERS: CustomerOption[] = [
  { id: "c1", name: "Tariro Moyo", phone: "+263715550184", address: "12 Fife Ave" },
  { id: "c2", name: "Rudo Chikafu", phone: "+263772119003" },
  { id: "c3", name: "Tanaka Ncube", phone: "+263783440021" },
];

const SAVED = {
  order: {
    id: "o1",
    invoiceNumber: 7,
    invoicePrefix: "INV",
    invoiceLabel: "INV-0007",
    invoiceToken: "i_specimen",
    revision: 0,
    sentAt: null,
    viewedAt: null,
    deliveryStatus: "notSent" as const,
    status: "confirmed" as const,
    cancellationReason: null,
    orderDate: "2026-08-04",
    deliveryDate: "2026-08-08",
    occasion: "birthday",
  },
  customer: { name: "Tariro Moyo", phone: "+263715550184" },
  lines: [
    { id: "l1", description: "Brownies", qtyMilli: 2_000, lineTotalCents: 600, uncosted: false },
    { id: "l2", description: "Sourdough loaf", qtyMilli: 1_000, lineTotalCents: 850, uncosted: false },
  ],
  totals: {
    subtotalCents: 1450,
    discountCents: 0,
    deliveryFeeCents: 500,
    taxAddedCents: 0,
    taxIncludedCents: 0,
    totalCents: 1950,
    depositCents: 0,
  },
  payments: {
    paidCents: 800,
    balanceCents: 1150,
    excessCents: 0,
    status: "partPaid" as const,
    rows: [
      {
        id: "p1",
        amountCents: 800,
        paidAt: Date.UTC(2026, 7, 4),
        method: "EcoCash",
        canRemove: true,
      },
    ],
    depositShown: false,
    depositCents: 0,
  },
  costing: {
    grossMarginPercent: 79,
    netMarginPercent: 18,
    leavesYouCents: 286,
    uncostedGoodsCents: 0,
    overheadRateSet: true,
    deliveryCostMissing: false,
  },
};

/** One item with axes, so the one-tap sheet has something to ask. */
const FEEDBACK_ITEMS = [
  {
    menuItemId: "brownie",
    name: "Brownies",
    axes: ["sweetness", "moisture"] as const,
  },
].map((i) => ({ ...i, axes: [...i.axes] }));

const ROWS: OrderRow[] = [
  {
    id: "o-ncube", invoiceNumber: 3, invoiceLabel: "INV-0003", customerName: "Mrs Ncube", isWalkIn: false,
    orderDate: "2026-06-20", deliveryDate: "2026-06-24", status: "confirmed",
    paymentStatus: "unpaid", totalCents: 3200, paidCents: 0, balanceCents: 3200,
    excessCents: 0, source: "app", deliveryStatus: "sent" as const, ageDays: 41, depositShown: true,
    depositCents: 1600,
    feedbackItems: FEEDBACK_ITEMS, feedbackCount: 0, customerReplied: false,
  },
  {
    id: "o-rudo", invoiceNumber: 5, invoiceLabel: "INV-0005", customerName: "Rudo Chikafu", isWalkIn: false,
    orderDate: "2026-07-20", deliveryDate: "2026-07-23", status: "confirmed",
    paymentStatus: "partPaid", totalCents: 1850, paidCents: 500,
    balanceCents: 1350, excessCents: 0, source: "app", deliveryStatus: "notSent" as const, ageDays: 12,
    depositShown: false, depositCents: 0,
    feedbackItems: FEEDBACK_ITEMS, feedbackCount: 0, customerReplied: false,
  },
  {
    id: "o-tariro", invoiceNumber: 7, invoiceLabel: "INV-0007", customerName: "Tariro Moyo", isWalkIn: false,
    orderDate: "2026-08-01", deliveryDate: "2026-08-01", status: "confirmed",
    paymentStatus: "paid", totalCents: 1950, paidCents: 2450, balanceCents: 0,
    excessCents: 500, source: "app", deliveryStatus: "viewed" as const, ageDays: 3, depositShown: false,
    depositCents: 0,
    feedbackItems: FEEDBACK_ITEMS, feedbackCount: 0, customerReplied: false,
  },
  {
    id: "o-walkin", invoiceNumber: 8, invoiceLabel: "INV-0008", customerName: "Walk-in", isWalkIn: true,
    orderDate: "2026-08-04", deliveryDate: "2026-08-04", status: "delivered",
    paymentStatus: "paid", totalCents: 150, paidCents: 150, balanceCents: 0,
    excessCents: 0, source: "quickSale", deliveryStatus: "sent" as const, ageDays: 0, depositShown: false,
    depositCents: 0,
    feedbackItems: FEEDBACK_ITEMS, feedbackCount: 0, customerReplied: false,
  },
];

const CHIPS = [
  { id: "scones", name: "Scones", priceCents: 150 },
  { id: "brownie", name: "Brownies", priceCents: 300 },
  { id: "sourdough", name: "Sourdough loaf", priceCents: 850 },
];

const pause = () => new Promise<void>((r) => setTimeout(r, 400));

type View = "form" | "staff" | "saved" | "list" | "quick";

export default function OrdersSpecimenPage() {
  const [view, setView] = React.useState<View>("form");
  const [prefill, setPrefill] = React.useState<number | null>(400);
  const [query, setQuery] = React.useState("");

  const customers = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return CUSTOMERS.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.phone.replace(/\D/g, "").includes(query.replace(/\D/g, "")),
    );
  }, [query]);

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Order flow specimen — sample data, saves are pretend
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button
            variant="outline"
            aria-pressed={prefill != null}
            onClick={() => setPrefill((p) => (p == null ? 400 : null))}
          >
            Delivery pre-fill {prefill == null ? "off" : "on"}
          </Button>
          <div className="min-w-0 max-w-full overflow-x-auto">
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="form">Owner</TabsTrigger>
                <TabsTrigger value="staff">Staff</TabsTrigger>
                <TabsTrigger value="saved">Saved</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="quick">Quick sale</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ModeToggle />
        </div>
      </div>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-10">
        {view === "quick" ? (
          <QuickSaleSpecimen />
        ) : view === "list" ? (
          <OrdersListSpecimen />
        ) : view === "saved" ? (
          <SavedOrderView
            data={SAVED}
            batchesMade={2}
            onCancelOrder={pause}
            onRecordPayment={pause}
            onRemovePayment={pause}
          />
        ) : (
          <OrderForm
            key={`${view}-${prefill}`}
            menu={MENU}
            customers={customers}
            deliveryFeeModel="flat"
            deliveryFeeConfig={{ flatCents: 500 }}
            tax={{ enabled: false, rateBp: 0, inclusive: false }}
            deliveryCostPrefillCents={view === "staff" ? null : prefill}
            canSeeCosts={view === "form"}
            onCustomerQuery={setQuery}
            onSave={pause}
          />
        )}
      </main>
    </div>
  );
}

/** The orders list, with the Owing filter doing the real filtering. */
function OrdersListSpecimen() {
  const [filter, setFilter] = React.useState<OrdersFilter>("owing");
  const [justPaid, setJustPaid] = React.useState<{
    rowId: string;
    paymentId: string;
    amountCents: number;
  } | null>(null);
  const rows = React.useMemo(() => {
    if (filter === "upcoming") {
      return ROWS.filter((r) => r.status === "confirmed" && r.deliveryDate >= "2026-08-04");
    }
    if (filter === "owing") {
      return [...ROWS]
        .filter((r) => r.status !== "cancelled" && r.balanceCents > 0)
        .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    }
    return ROWS;
  }, [filter]);
  const owing = ROWS.filter((r) => r.balanceCents > 0);
  return (
    <OrdersList
      orgSlug="kitchen-a"
      filter={filter}
      onFilterChange={setFilter}
      rows={rows}
      owedCents={owing.reduce((s, r) => s + r.balanceCents, 0)}
      owingCount={owing.length}
      justPaid={justPaid}
      onRecordFull={(row) =>
        setJustPaid({ rowId: row.id, paymentId: "p", amountCents: row.balanceCents })
      }
      onRecordDeposit={(row) =>
        setJustPaid({ rowId: row.id, paymentId: "p", amountCents: row.depositCents })
      }
      onUndoPayment={() => setJustPaid(null)}
    />
  );
}

/**
 * The real sheet behind a real FAB, so the tap count is the shipped one.
 * Only the Convex calls are stubbed.
 */
function QuickSaleSpecimen() {
  const [open, setOpen] = React.useState(false);
  const [recorded, setRecorded] = React.useState<RecordedSale | null>(null);
  return (
    <div className="flex min-h-80 flex-col gap-3">
      <p className="type-body text-muted-foreground">
        Tap the button, then tap an item. That is the whole sale.
      </p>
      <div className="fixed right-4 bottom-6 z-40">
        <Drawer
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) window.setTimeout(() => setRecorded(null), 200);
          }}
        >
          <DrawerTrigger
            aria-label="Quick actions"
            className={cn(
              "flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float outline-none",
              "transition-transform duration-[var(--duration-fast)] ease-out active:scale-[0.97]",
              "focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          >
            <Plus aria-hidden className="size-6" />
          </DrawerTrigger>
          <DrawerContent style={{ "--duration-drawer": "240ms" } as React.CSSProperties}>
            <DrawerHeader>
              <DrawerTitle>Quick actions</DrawerTitle>
            </DrawerHeader>
            <QuickSaleSheet
              orgSlug="kitchen-a"
              items={CHIPS}
              hasMenuItems
              recorded={recorded}
              onSell={(item) =>
                setRecorded({
                  orderId: "o-new",
                  itemName: item.name,
                  qtyMilli: 1000,
                  totalCents: item.priceCents,
                })
              }
              onSetQuantity={(n) =>
                setRecorded((r) =>
                  r
                    ? { ...r, qtyMilli: n * 1000, totalCents: (r.totalCents / (r.qtyMilli / 1000)) * n }
                    : r,
                )
              }
              onUndo={() => setOpen(false)}
              onDone={() => setOpen(false)}
            />
          </DrawerContent>
        </Drawer>
      </div>
    </div>
  );
}
