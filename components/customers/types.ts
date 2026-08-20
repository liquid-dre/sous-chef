import type { Occasion, Reminder } from "@/convex/lib/contacts";

/**
 * The customers screen's view model, free of Convex so the specimen can mount
 * every state without a kitchen behind it — the split
 * `components/production/production-form.tsx` established.
 */

export interface ContactRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  marketingConsent: boolean;
  optedOut: boolean;
  orders: number;
  lifetimeRevenueCents: number;
  lifetimeProfitCents: number;
  marginPercent: number | null;
  lastOrderedOn: string | null;
}

export interface ContactDetail extends ContactRow {
  address: string | null;
  notes: string | null;
  history: {
    orderId: string;
    deliveryDate: string;
    occasion: Occasion | null;
    revenueCents: number;
    profitCents: number;
    reason: string | null;
  }[];
  occasions: { occasion: Occasion; orders: number; revenueCents: number }[];
  reminders: Reminder[];
}

export type { Occasion, Reminder };
