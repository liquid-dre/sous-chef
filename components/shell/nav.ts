import type { Role } from "@/lib/auth/org";

/**
 * The single nav config (CONTEXT.md — Routes). Filtered BY ROLE ON THE
 * SERVER in app/[orgSlug]/layout.tsx: staff receive exactly three items in
 * props and DOM — the other six are never serialised, never rendered, never
 * display:none. Icons travel as keys because component functions don't
 * serialise across the server boundary; the client shell maps them.
 */

export type IconKey =
  | "home"
  | "orders"
  | "calendar"
  | "menu"
  | "pantry"
  | "alerts"
  | "customers"
  | "messages"
  | "settings";

export interface NavItem {
  label: string;
  /** Path segment under /[orgSlug]; "" is Home. */
  segment: string;
  iconKey: IconKey;
  /** On the mobile bottom bar (max 5 slots incl. More), or behind More. */
  mobilePrimary: boolean;
  /** Attaches the live unresolved-alerts badge. Owner nav only. */
  badge?: "alerts";
}

const OWNER_NAV: NavItem[] = [
  { label: "Home", segment: "", iconKey: "home", mobilePrimary: true },
  { label: "Orders", segment: "orders", iconKey: "orders", mobilePrimary: true },
  { label: "Calendar", segment: "calendar", iconKey: "calendar", mobilePrimary: true },
  { label: "Menu", segment: "menu", iconKey: "menu", mobilePrimary: false },
  { label: "Pantry", segment: "pantry", iconKey: "pantry", mobilePrimary: false },
  { label: "Alerts", segment: "alerts", iconKey: "alerts", mobilePrimary: true, badge: "alerts" },
  { label: "Customers", segment: "customers", iconKey: "customers", mobilePrimary: false },
  { label: "Messages", segment: "messages", iconKey: "messages", mobilePrimary: false },
  { label: "Settings", segment: "settings", iconKey: "settings", mobilePrimary: false },
];

const STAFF_NAV: NavItem[] = [
  { label: "Orders", segment: "orders", iconKey: "orders", mobilePrimary: true },
  { label: "Calendar", segment: "calendar", iconKey: "calendar", mobilePrimary: true },
  { label: "Menu", segment: "menu", iconKey: "menu", mobilePrimary: true },
];

export function navForRole(role: Role): NavItem[] {
  return role === "owner" ? OWNER_NAV : STAFF_NAV;
}
