"use client";

import * as React from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/numeric/money-input";
import { AnimatedMoney, AnimatedPercent } from "@/components/menu/animated-number";
import { computeInvoiceTotals, marginRevenueCents } from "@/lib/invoice-totals";
import { computeDeliveryFeeCents, type DeliveryFeeConfig, type DeliveryFeeModel } from "@/lib/delivery-fee";
import { addDays, defaultDeliveryDay } from "@/lib/day";
import { useClientToday } from "@/components/use-client-today";
import { cn } from "@/lib/utils";
import {
  CustomerTypeahead,
  type CustomerOption,
  type CustomerValue,
} from "./customer-typeahead";
import { OccasionChips, type Occasion } from "./occasion-chips";

/**
 * The order form, built against a tap budget: a two-item order for a repeat
 * customer is five taps. Everything that can default, defaults; everything
 * that can be one tap, is one tap.
 *
 * The one thing that is deliberately NOT optimised away is the delivery cost.
 * A fee with no cost against it makes the dashboard read $5 of profit on a
 * delivery that cost $4 — so it is pre-filled from what Sous already knows and
 * shown beside the fee, never hidden behind a disclosure.
 */

export interface MenuOption {
  id: string;
  name: string;
  notSoldDirectly: boolean;
  priceCents: number | null;
  leadTimeHours: number | null;
  /** Owner only — absent for staff, whose menu query carries no costs at
   * all. Without these the live margin would read 100% on every order. */
  variableCentsPerUnit?: number;
  overheadCentsPerUnit?: number;
}

export interface OrderLineDraft {
  key: string;
  menuItemId?: string;
  description?: string;
  name: string;
  qtyMilli: number;
  unitPriceCents: number;
  /** Off-menu only. */
  roughCostCents?: number;
  uncosted: boolean;
  /** Menu lines only — per unit, for the live margin. */
  variableCentsPerUnit?: number;
  overheadCentsPerUnit?: number;
}

export interface OrderDraft {
  customer: CustomerValue;
  orderDate: string;
  deliveryDate: string;
  /** She edited it, so stop recomputing it under her. */
  deliveryDateTouched: boolean;
  occasion: Occasion | null;
  lines: OrderLineDraft[];
  discountCents: number;
  deliveryKmMilli: number | null;
  deliveryCostCents: number | null;
}

let seq = 0;
const lineKey = () => `ol-${seq++}`;

/**
 * Dates start EMPTY and are filled on mount, never during render.
 *
 * `today()` reads the local clock, and this component server-renders too —
 * so a kitchen in Harare opening the form at 00:30 would get a server day of
 * "yesterday" against a client day of "today". That is both a hydration
 * mismatch and, far worse, an order quietly filed to the wrong day.
 */
export const emptyOrder = (): OrderDraft => ({
  customer: { label: "", name: "", phone: "" },
  orderDate: "",
  deliveryDate: "",
  deliveryDateTouched: false,
  occasion: null,
  lines: [],
  discountCents: 0,
  deliveryKmMilli: null,
  deliveryCostCents: null,
});

function dollars(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}
function toCents(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function OrderForm({
  menu,
  customers,
  deliveryFeeModel,
  deliveryFeeConfig,
  tax,
  deliveryCostPrefillCents,
  canSeeCosts,
  onCustomerQuery,
  onSave,
  saving,
}: {
  menu: MenuOption[];
  customers: CustomerOption[];
  deliveryFeeModel: DeliveryFeeModel;
  deliveryFeeConfig: DeliveryFeeConfig;
  tax: { enabled: boolean; rateBp: number; inclusive: boolean };
  /** From the org's own cost model or her last delivery. Null = ask. */
  deliveryCostPrefillCents: number | null;
  /** Staff never see costs, so the margin block and the cost field are hers. */
  canSeeCosts: boolean;
  onCustomerQuery: (q: string) => void;
  onSave: (draft: OrderDraft) => Promise<void>;
  saving?: boolean;
}) {
  const [draft, setDraft] = React.useState<OrderDraft>(emptyOrder);
  const [search, setSearch] = React.useState("");

  // Empty in the draft means "she hasn't chosen", so the client's clock
  // supplies it. Once she edits a date, the draft's value takes over.
  const clientToday = useClientToday();
  const orderDate = draft.orderDate || clientToday;
  const deliveryDate =
    draft.deliveryDate || (clientToday ? addDays(clientToday, 1) : "");

  const [offMenu, setOffMenu] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The pre-fill lands once, and never fights her after she has typed.
  const [costTouched, setCostTouched] = React.useState(false);
  const deliveryCostCents = costTouched
    ? draft.deliveryCostCents
    : (draft.deliveryCostCents ?? deliveryCostPrefillCents);

  const sellable = React.useMemo(
    () => menu.filter((m) => !m.notSoldDirectly),
    [menu],
  );
  const chips = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = needle
      ? sellable.filter((m) => m.name.toLowerCase().includes(needle))
      : sellable;
    return rows.slice(0, 12);
  }, [sellable, search]);

  /** Adding an item IS the tap — no "add line" step in between. */
  const addItem = (item: MenuOption) => {
    setDraft((d) => {
      const existing = d.lines.find((l) => l.menuItemId === item.id);
      const lines = existing
        ? // Tapping the same chip again is her saying "one more", which is
          // what she means far more often than "a second identical line".
          d.lines.map((l) =>
            l.key === existing.key ? { ...l, qtyMilli: l.qtyMilli + 1000 } : l,
          )
        : [
            ...d.lines,
            {
              key: lineKey(),
              menuItemId: item.id,
              name: item.name,
              qtyMilli: 1000,
              unitPriceCents: item.priceCents ?? 0,
              uncosted: false,
              variableCentsPerUnit: item.variableCentsPerUnit,
              overheadCentsPerUnit: item.overheadCentsPerUnit,
            },
          ];
      const nextDeliveryDate = d.deliveryDateTouched
        ? d.deliveryDate
        : defaultDeliveryDay(
            d.orderDate || clientToday,
            lines.map(
              (l) => menu.find((m) => m.id === l.menuItemId)?.leadTimeHours ?? null,
            ),
          );
      return { ...d, lines, deliveryDate: nextDeliveryDate };
    });
  };

  const setQty = (key: string, next: number | ((current: number) => number)) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => {
        if (l.key !== key) return l;
        const value = typeof next === "function" ? next(l.qtyMilli) : next;
        return { ...l, qtyMilli: Math.max(1000, value) };
      }),
    }));

  // --- live money, the same functions the server will use ---
  const totals = computeInvoiceTotals({
    lines: draft.lines.map((l) => ({
      description: l.name,
      qtyMilli: l.qtyMilli,
      unitPriceCents: l.unitPriceCents,
    })),
    deliveryFeeCents: 0,
    discountCents: draft.discountCents,
    tax,
  });
  const goodsCents = totals.subtotalCents - totals.discountCents;
  const feeQuote = computeDeliveryFeeCents({
    model: deliveryFeeModel,
    config: deliveryFeeConfig,
    goodsCents,
    kmMilli: draft.deliveryKmMilli,
  });
  const withFee = computeInvoiceTotals({
    lines: draft.lines.map((l) => ({
      description: l.name,
      qtyMilli: l.qtyMilli,
      unitPriceCents: l.unitPriceCents,
    })),
    deliveryFeeCents: feeQuote.cents,
    discountCents: draft.discountCents,
    tax,
  });

  const lineTotal = (l: OrderLineDraft) =>
    Math.round((l.qtyMilli * l.unitPriceCents) / 1000);

  // Margins on the costed share only, against revenue with inclusive tax
  // removed — the two corrections that keep this honest.
  const revenue = marginRevenueCents(withFee);
  const costedGross = draft.lines
    .filter((l) => !l.uncosted)
    .reduce((s, l) => s + lineTotal(l), 0);
  const uncostedGross = draft.lines
    .filter((l) => l.uncosted)
    .reduce((s, l) => s + lineTotal(l), 0);
  const costedShare =
    withFee.subtotalCents > 0 ? costedGross / withFee.subtotalCents : 0;
  const costedRevenue = Math.round(revenue * costedShare);
  const layer12 = draft.lines.reduce(
    (s, l) => s + Math.round((l.variableCentsPerUnit ?? 0) * (l.qtyMilli / 1000)),
    0,
  );
  const layer3 = draft.lines.reduce(
    (s, l) => s + Math.round((l.overheadCentsPerUnit ?? 0) * (l.qtyMilli / 1000)),
    0,
  );
  const netRevenue = costedRevenue + feeQuote.cents;
  const netCost = layer12 + layer3 + (deliveryCostCents ?? 0);
  const grossPercent =
    costedRevenue > 0 ? ((costedRevenue - layer12) * 100) / costedRevenue : 0;
  const netPercent = netRevenue > 0 ? ((netRevenue - netCost) * 100) / netRevenue : 0;

  const ready = draft.lines.length > 0 && draft.customer.name.trim() !== "";

  return (
    <div className="flex flex-col gap-5 pb-32">
      {/* --- who and when --- */}
      <section aria-label="Customer and dates" className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:p-5">
        <div className="flex flex-col gap-1.5">
          <Label className="type-label">Who is it for</Label>
          <CustomerTypeahead
            value={draft.customer}
            options={customers}
            autoFocus
            onChange={(customer) => {
              setDraft((d) => ({ ...d, customer }));
              onCustomerQuery(customer.label);
            }}
          />
        </div>

        {!draft.customer.customerId && draft.customer.label.trim() !== "" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-phone" className="type-label">
              Their number
            </Label>
            <Input
              id="order-phone"
              value={draft.customer.phone}
              inputMode="tel"
              placeholder="+263 71 555 0184"
              className="numeric-body"
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  customer: { ...d.customer, phone: e.target.value },
                }))
              }
            />
            <p className="type-caption text-muted-foreground">
              The number is how Sous recognises her next time.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-date" className="type-label">
              Ordered
            </Label>
            <Input
              id="order-date"
              type="date"
              value={orderDate}
              className="numeric-body"
              onChange={(e) =>
                setDraft((d) => ({ ...d, orderDate: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delivery-date" className="type-label">
              Deliver
            </Label>
            <Input
              id="delivery-date"
              type="date"
              value={deliveryDate}
              className="numeric-body"
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  deliveryDate: e.target.value,
                  deliveryDateTouched: true,
                }))
              }
            />
            {!draft.deliveryDateTouched && (
              <p className="type-caption text-muted-foreground">
                Soonest you could make it.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* --- what --- */}
      <section aria-label="Items" className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5">
        <h2 className="type-title">What they&rsquo;re having</h2>

        {draft.lines.length === 0 ? (
          <p className="type-caption text-muted-foreground">
            Nothing on it yet. Tap something below.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {draft.lines.map((line) => (
              <li key={line.key} className="flex items-center gap-2 py-2 md:gap-3">
                <span className="min-w-0 flex-1">
                  <span className="type-body block truncate">{line.name}</span>
                  {line.uncosted && (
                    <span className="type-caption block text-muted-foreground">
                      off-menu — not in the margin
                    </span>
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`One fewer ${line.name}`}
                    onClick={() => setQty(line.key, (q) => q - 1000)}
                  >
                    <Minus aria-hidden />
                  </Button>
                  <Input
                    value={String(line.qtyMilli / 1000)}
                    inputMode="numeric"
                    aria-label={`Quantity of ${line.name}`}
                    className="numeric-body w-14 text-center"
                    onChange={(e) => {
                      const n = Number.parseFloat(e.target.value);
                      if (Number.isFinite(n)) setQty(line.key, Math.round(n * 1000));
                    }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`One more ${line.name}`}
                    onClick={() => setQty(line.key, (q) => q + 1000)}
                  >
                    <Plus aria-hidden />
                  </Button>
                </div>
                <span className="numeric-sm w-16 shrink-0 text-right">
                  <AnimatedMoney cents={lineTotal(line)} />
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${line.name}`}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      lines: d.lines.filter((l) => l.key !== line.key),
                    }))
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Input
          value={search}
          aria-label="Search the menu"
          placeholder="Search the menu…"
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* One tap per line: the chip IS the add. */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Menu">
          {chips.map((item) => {
            // How many are already on the order. Tapping a chip a second
            // time adds one more, and without this the only evidence is a
            // line that may have scrolled out of sight — the tap would look
            // like it did nothing. It also answers "what's already on this?"
            // before she taps at all.
            const onOrder = draft.lines
              .filter((l) => l.menuItemId === item.id)
              .reduce((s, l) => s + l.qtyMilli, 0) / 1000;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={
                  onOrder > 0
                    ? `${item.name}, ${onOrder} on the order — add another`
                    : `Add ${item.name}`
                }
                onClick={() => addItem(item)}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-full border px-3 type-label outline-none transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-9",
                  onOrder > 0 ? "border-primary text-primary" : "bg-card",
                )}
              >
                <Plus aria-hidden className="size-3.5" />
                {item.name}
                {onOrder > 0 && (
                  <span className="numeric-sm rounded-full bg-primary px-1.5 text-primary-foreground">
                    {onOrder}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setOffMenu(true)}
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-dashed px-3 type-label text-muted-foreground outline-none transition-transform duration-[var(--duration-fast)] ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-9"
          >
            <Plus aria-hidden className="size-3.5" />
            Something else…
          </button>
        </div>

        {offMenu && (
          <OffMenuLine
            canSeeCosts={canSeeCosts}
            onCancel={() => setOffMenu(false)}
            onAdd={(line) => {
              setDraft((d) => ({ ...d, lines: [...d.lines, line] }));
              setOffMenu(false);
            }}
          />
        )}
      </section>

      {/* --- occasion: one tap, and it is what makes every reorder
             reminder in Phase 8 possible --- */}
      <section aria-label="Occasion" className="flex flex-col gap-2 rounded-lg border bg-card p-4 md:p-5">
        <h2 className="type-title">What&rsquo;s the occasion</h2>
        <OccasionChips
          value={draft.occasion}
          onChange={(occasion) => setDraft((d) => ({ ...d, occasion }))}
        />
      </section>

      {/* --- delivery --- */}
      <section aria-label="Delivery" className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5">
        <h2 className="type-title">Getting it there</h2>

        {deliveryFeeModel === "perKm" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delivery-km" className="type-label">
              How far
            </Label>
            <div className="relative w-32">
              <Input
                id="delivery-km"
                value={draft.deliveryKmMilli == null ? "" : String(draft.deliveryKmMilli / 1000)}
                inputMode="decimal"
                placeholder="7.5"
                className="numeric-body pr-10 md:pr-10"
                onChange={(e) => {
                  const n = Number.parseFloat(e.target.value);
                  setDraft((d) => ({
                    ...d,
                    deliveryKmMilli: Number.isFinite(n) ? Math.round(n * 1000) : null,
                  }));
                }}
              />
              <span className="type-caption pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
                km
              </span>
            </div>
          </div>
        )}

        <dl className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="type-body">You charge</dt>
            <dd className="numeric-body">
              <AnimatedMoney cents={feeQuote.cents} />
            </dd>
          </div>
          {canSeeCosts && (
            <div className="flex items-center justify-between gap-3 pt-1">
              <Label htmlFor="delivery-cost" className="type-body">
                Fuel and time
              </Label>
              <MoneyInput
                id="delivery-cost"
                className="w-28"
                aria-label="What the delivery costs you"
                value={dollars(deliveryCostCents)}
                onChange={(v) => {
                  setCostTouched(true);
                  setDraft((d) => ({ ...d, deliveryCostCents: toCents(v) }));
                }}
              />
            </div>
          )}
        </dl>

        {feeQuote.reason === "unconfigured" && (
          <p className="type-caption text-warn-foreground">
            Your delivery pricing isn&rsquo;t set up, so this is showing nothing
            rather than guessing. Settings → Delivery.
          </p>
        )}
        {canSeeCosts && deliveryCostCents == null && feeQuote.cents > 0 && (
          <p className="type-caption text-warn-foreground">
            Nothing here yet, so this delivery will look like pure profit.
          </p>
        )}
        {canSeeCosts && deliveryCostPrefillCents != null && !costTouched && (
          <p className="type-caption text-muted-foreground">
            From your last delivery — change it if this one is different.
          </p>
        )}
      </section>

      {/* --- money --- */}
      <section aria-label="Total" className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="order-discount" className="type-body">
            Anything off
          </Label>
          <MoneyInput
            id="order-discount"
            className="w-28"
            aria-label="Discount"
            value={draft.discountCents === 0 ? "" : dollars(draft.discountCents)}
            onChange={(v) =>
              setDraft((d) => ({ ...d, discountCents: toCents(v) ?? 0 }))
            }
          />
        </div>

        <dl className="flex flex-col gap-1 border-t pt-3">
          <Row label="Items" value={withFee.subtotalCents} />
          {withFee.discountCents > 0 && (
            <Row label="Less" value={-withFee.discountCents} />
          )}
          {withFee.deliveryFeeCents > 0 && (
            <Row label="Delivery" value={withFee.deliveryFeeCents} />
          )}
          {withFee.taxAddedCents > 0 && (
            <Row label="Tax" value={withFee.taxAddedCents} />
          )}
          <div className="flex items-baseline justify-between gap-3 border-t pt-2">
            <dt className="type-label">Total</dt>
            <dd className="numeric-lg">
              <AnimatedMoney cents={withFee.totalCents} />
            </dd>
          </div>
        </dl>

        {canSeeCosts && draft.lines.length > 0 && (
          <dl className="grid grid-cols-3 gap-3 border-t pt-3">
            <div>
              <dt className="type-caption text-muted-foreground">Gross</dt>
              <dd className="numeric-lg">
                <AnimatedPercent percent={grossPercent} />
              </dd>
              <dd className="type-caption text-muted-foreground">on the food</dd>
            </div>
            <div>
              <dt className="type-caption text-muted-foreground">Net</dt>
              <dd className="numeric-lg">
                <AnimatedPercent percent={netPercent} />
              </dd>
              <dd className="type-caption text-muted-foreground">
                after everything
              </dd>
            </div>
            <div>
              <dt className="type-caption text-muted-foreground">Leaves you</dt>
              <dd className="numeric-lg">
                <AnimatedMoney cents={netRevenue - netCost} />
              </dd>
              {uncostedGross > 0 && (
                <dd className="type-caption text-muted-foreground">
                  excludes off-menu
                </dd>
              )}
            </div>
          </dl>
        )}
      </section>

      {error && (
        <p className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground" role="alert">
          {error}
        </p>
      )}

      {/* Thumb-reachable, above the tab bar, clear of the home indicator. */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-card/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:bottom-0">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <span className="type-caption text-muted-foreground">
            {draft.lines.length === 0
              ? "Nothing on it yet"
              : `${draft.lines.length} ${draft.lines.length === 1 ? "line" : "lines"} · `}
            {draft.lines.length > 0 && (
              <span className="numeric">
                <AnimatedMoney cents={withFee.totalCents} />
              </span>
            )}
          </span>
          <Button
            size="lg"
            disabled={!ready || saving}
            onClick={async () => {
              setError(null);
              try {
                await onSave({
                  ...draft,
                  orderDate,
                  deliveryDate,
                  deliveryCostCents: deliveryCostCents ?? 0,
                });
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't save it.");
              }
            }}
          >
            {saving ? "Saving…" : "Save the order"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="type-body text-muted-foreground">{label}</dt>
      <dd className="numeric-sm">
        <AnimatedMoney cents={value} />
      </dd>
    </div>
  );
}

/** Off-menu: a description, a price, and — for the owner — a rough cost so
 * the margin on screen still means something. Flagged uncosted, and kept out
 * of every aggregate downstream. */
function OffMenuLine({
  canSeeCosts,
  onAdd,
  onCancel,
}: {
  canSeeCosts: boolean;
  onAdd: (line: OrderLineDraft) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [cost, setCost] = React.useState("");
  const priceCents = toCents(price);
  const ready = description.trim() !== "" && priceCents != null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="off-menu-desc" className="type-label">
          What is it
        </Label>
        <Input
          id="off-menu-desc"
          value={description}
          autoFocus
          placeholder="Custom cupcake tower"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="off-menu-price" className="type-label">
            You charge
          </Label>
          <MoneyInput id="off-menu-price" value={price} onChange={setPrice} />
        </div>
        {canSeeCosts && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="off-menu-cost" className="type-label">
              Roughly costs you
            </Label>
            <MoneyInput id="off-menu-cost" value={cost} onChange={setCost} />
          </div>
        )}
      </div>
      <p className="type-caption text-muted-foreground">
        Sous can&rsquo;t cost this properly, so it stays out of your reports —
        the rough figure is only for the margin on this screen.
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!ready}
          onClick={() =>
            onAdd({
              key: lineKey(),
              description: description.trim(),
              name: description.trim(),
              qtyMilli: 1000,
              unitPriceCents: priceCents!,
              roughCostCents: toCents(cost) ?? undefined,
              uncosted: true,
            })
          }
        >
          Add it
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
