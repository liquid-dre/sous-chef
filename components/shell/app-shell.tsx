"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarDays,
  Ellipsis,
  House,
  MessageCircle,
  NotebookPen,
  Settings2,
  ShoppingBasket,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import type { IconKey, NavItem } from "@/components/shell/nav";
import { AlertsBadge } from "@/components/shell/alerts-badge";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { QuickAction } from "@/components/shell/quick-action";
import { ModeToggle } from "@/components/theme/mode-toggle";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

const ICONS: Record<IconKey, LucideIcon> = {
  home: House,
  orders: NotebookPen,
  calendar: CalendarDays,
  menu: UtensilsCrossed,
  pantry: ShoppingBasket,
  alerts: Bell,
  customers: Users,
  messages: MessageCircle,
  settings: Settings2,
};

const MOBILE_SLOTS = 5;

/**
 * The app chrome (CONTEXT.md — Routes): sidebar on desktop, bottom tab bar
 * on mobile, identical routes, one nav config. `items` arrive pre-filtered
 * by role from the server layout — this component never sees, hides, or
 * decides what a staff user may not. Nav is used dozens of times a day, so
 * none of it animates: active state snaps, routes cut, tabs hold still
 * (DESIGN.md §6). The quick action is the only moving part.
 */
export function AppShell({
  orgSlug,
  orgName,
  items,
  banner,
  children,
}: {
  orgSlug: string;
  orgName: string;
  items: NavItem[];
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const fitsBar = items.length <= MOBILE_SLOTS;
  const barItems = fitsBar
    ? items
    : items.filter((i) => i.mobilePrimary).slice(0, MOBILE_SLOTS - 1);
  const moreItems = fitsBar ? [] : items.filter((i) => !barItems.includes(i));

  return (
    /**
     * `--banner-h` is what lets the impersonation strip exist at all.
     *
     * 3.5rem is the strip's OWN fixed height (h-14 in
     * impersonation-banner.tsx), which is why that component may not wrap.
     * Measured, not assumed: an earlier draft let the text wrap to 93px while
     * this still said 40px, and the fixed mobile bar landed on top of it.
     *
     * The strip sits in normal flow, but the mobile top bar is `fixed top-0`
     * and the desktop sidebar is `sticky top-0 h-dvh` — so without an offset
     * the bar would cover the strip on a phone and the sidebar would overflow
     * the viewport by exactly the strip's height on a laptop. One variable,
     * read by all three, rather than three components each being told a
     * boolean and each deciding what to do about it.
     */
    <div
      className="flex min-h-dvh flex-col"
      style={
        { "--banner-h": banner ? "3.5rem" : "0px" } as React.CSSProperties
      }
    >
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 type-label text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {banner && <div className="sticky top-0 z-50">{banner}</div>}
      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <aside className="sticky top-[var(--banner-h)] hidden h-[calc(100dvh-var(--banner-h))] w-60 shrink-0 flex-col border-r bg-card md:flex">
          <div className="px-5 pt-5 pb-2">
            <p className="type-flourish text-primary" aria-hidden>
              Sous
            </p>
          </div>
          <div className="px-3 pb-2">
            <OrgSwitcher currentSlug={orgSlug} currentName={orgName} />
          </div>
          <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-3 py-2">
            {items.map((item) => (
              <SideLink key={item.segment} item={item} orgSlug={orgSlug} />
            ))}
          </nav>
          <div className="flex items-center justify-between border-t px-4 py-3">
            <UserButton />
            <ModeToggle />
          </div>
        </aside>

        {/* Mobile top bar */}
        <div className="fixed inset-x-0 top-[var(--banner-h)] z-40 flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
          <p className="type-flourish text-primary" aria-hidden>
            Sous
          </p>
          <div className="flex items-center gap-2">
            <OrgSwitcher currentSlug={orgSlug} currentName={orgName} />
            <UserButton />
          </div>
        </div>

        {/* Content */}
        {/* pt-18 clears the fixed mobile bar. It needs NO banner offset: the
            banner is in normal flow, so it has already pushed this element's
            box down by exactly its own height. */}
        <main id="main" className="min-w-0 flex-1 px-4 pt-18 pb-32 md:px-6 md:pt-8 md:pb-8">
          {children}
        </main>
      </div>

      <QuickAction orgSlug={orgSlug} />

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {barItems.map((item) => (
          <TabLink key={item.segment} item={item} orgSlug={orgSlug} />
        ))}
        {moreItems.length > 0 && <MoreTab items={moreItems} orgSlug={orgSlug} />}
      </nav>
    </div>
  );
}

function useIsActive(orgSlug: string, segment: string): boolean {
  const pathname = usePathname();
  const href = segment ? `/${orgSlug}/${segment}` : `/${orgSlug}`;
  return segment ? pathname.startsWith(href) : pathname === href;
}

function SideLink({ item, orgSlug }: { item: NavItem; orgSlug: string }) {
  const active = useIsActive(orgSlug, item.segment);
  const Icon = ICONS[item.iconKey];
  return (
    <Link
      href={item.segment ? `/${orgSlug}/${item.segment}` : `/${orgSlug}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-9 items-center gap-2.5 rounded-md px-2.5 type-label outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "bg-primary-soft text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="size-4" strokeWidth={active ? 2.2 : 1.8} />
      <span className="flex-1">{item.label}</span>
      {item.badge === "alerts" && <AlertsBadge orgSlug={orgSlug} />}
    </Link>
  );
}

function TabLink({ item, orgSlug }: { item: NavItem; orgSlug: string }) {
  const active = useIsActive(orgSlug, item.segment);
  const Icon = ICONS[item.iconKey];
  return (
    <Link
      href={item.segment ? `/${orgSlug}/${item.segment}` : `/${orgSlug}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-11 flex-1 flex-col items-center justify-center gap-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <span className="relative">
        <Icon aria-hidden className="size-5" strokeWidth={active ? 2.2 : 1.8} />
        {item.badge === "alerts" && (
          <span className="absolute -top-1.5 -right-2.5">
            <AlertsBadge orgSlug={orgSlug} />
          </span>
        )}
      </span>
      <span className="type-caption">{item.label}</span>
    </Link>
  );
}

function MoreTab({ items, orgSlug }: { items: NavItem[]; orgSlug: string }) {
  return (
    <Drawer>
      <DrawerTrigger className="flex min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Ellipsis aria-hidden className="size-5" strokeWidth={1.8} />
        <span className="type-caption">More</span>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>More</DrawerTitle>
        </DrawerHeader>
        <nav aria-label="More" className="flex flex-col gap-0.5 p-4 pt-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {items.map((item) => {
            const Icon = ICONS[item.iconKey];
            return (
              <DrawerClose asChild key={item.segment}>
                <Link
                  href={`/${orgSlug}/${item.segment}`}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2.5 type-body text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Icon aria-hidden className="size-5" strokeWidth={1.8} />
                  {item.label}
                </Link>
              </DrawerClose>
            );
          })}
        </nav>
      </DrawerContent>
    </Drawer>
  );
}
