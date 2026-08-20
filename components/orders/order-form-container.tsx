"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrderForm, type MenuOption } from "./order-form";
import type { Occasion } from "./occasion-chips";

/** Wires the order form to Convex. The form itself stays pure so the
 * design-system specimen can mount it without a session. */
export function OrderFormContainer({
  orgSlug,
  canSeeCosts,
}: {
  orgSlug: string;
  canSeeCosts: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const menu = useQuery(api.menuItems.listForKitchen, { orgSlug });
  // The owner also needs per-item costs, or the live margin is a lie —
  // listForKitchen deliberately carries none, so staff simply have no
  // margin block to feed.
  const costed = useQuery(api.menuItems.list, canSeeCosts ? { orgSlug } : "skip");
  const defaults = useQuery(api.orders.entryDefaults, { orgSlug });
  const customers = useQuery(api.orders.searchCustomers, { orgSlug, q: query });
  // Owner-only: her cost side. Staff get null and the field never renders.
  const prefill = useQuery(
    api.orders.deliveryCostPrefill,
    canSeeCosts ? { orgSlug } : "skip",
  );
  const create = useMutation(api.orders.create);

  if (!menu || !defaults) return null;

  const costs = new Map(
    (costed?.rows ?? []).map((r) => [
      r.id as string,
      {
        variableCentsPerUnit: r.variableCentsPerUnit,
        overheadCentsPerUnit: r.totalCentsPerUnit - r.variableCentsPerUnit,
      },
    ]),
  );

  const options: MenuOption[] = menu.map((m) => ({
    id: m.id,
    name: m.name,
    notSoldDirectly: m.notSoldDirectly,
    priceCents: m.priceCents,
    leadTimeHours: m.leadTimeHours,
    ...costs.get(m.id),
  }));

  return (
    <OrderForm
      menu={options}
      customers={customers ?? []}
      deliveryFeeModel={defaults.deliveryFeeModel}
      deliveryFeeConfig={defaults.deliveryFeeConfig}
      tax={{
        enabled: defaults.taxEnabled,
        rateBp: defaults.taxRateBp,
        inclusive: defaults.taxInclusive,
      }}
      deliveryCostPrefillCents={prefill?.cents ?? null}
      canSeeCosts={canSeeCosts}
      saving={saving}
      onCustomerQuery={setQuery}
      onSave={async (draft) => {
        setSaving(true);
        try {
          const { orderId } = await create({
            orgSlug,
            customerId: draft.customer.customerId as Id<"customers"> | undefined,
            phone: draft.customer.phone,
            name: draft.customer.name,
            email: draft.customer.email ?? undefined,
            address: draft.customer.address ?? undefined,
            orderDate: draft.orderDate,
            deliveryDate: draft.deliveryDate,
            occasion: (draft.occasion ?? undefined) as Occasion | undefined,
            lines: draft.lines.map((l) => ({
              menuItemId: l.menuItemId as Id<"menuItems"> | undefined,
              description: l.description,
              qtyMilli: l.qtyMilli,
              unitPriceCents: l.unitPriceCents,
              // Cost data is owner-only; the server refuses it from staff.
              roughCostCents: canSeeCosts ? l.roughCostCents : undefined,
            })),
            discountCents: draft.discountCents,
            deliveryKmMilli: draft.deliveryKmMilli ?? undefined,
            deliveryCostCents: canSeeCosts
              ? (draft.deliveryCostCents ?? 0)
              : undefined,
          });
          router.push(`/${orgSlug}/orders/${orderId}`);
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}
