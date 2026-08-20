"use client";

import * as React from "react";
import { Eye } from "lucide-react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrgTable } from "@/components/admin/org-table";
import { OrgDetail } from "@/components/admin/org-detail";
import { ProvisionForm } from "@/components/admin/provision-form";
import type { AdminOrgRow, ImpersonationRow } from "@/components/admin/types";

/**
 * Admin specimen — the grading surface for this slice.
 *
 * Two things here have never been seen anywhere else.
 *
 * The first is the impersonation banner. `app/design-system/shell/page.tsx`
 * renders AppShell without the `banner` prop, so the slot has existed for
 * several slices with nothing in it — and the banner is the one piece of
 * chrome that changes the shell's own geometry (the mobile top bar is fixed
 * and the sidebar is a sticky h-dvh, both of which have to move out of its
 * way). The "Banner" tab makes that geometry measurable.
 *
 * The second is "not provisioned" — a kitchen that exists in Clerk with no
 * Sous row. It is the state a half-failed provision leaves behind, it is
 * genuinely reachable, and it is the one row state that needs an action
 * rather than a colour.
 *
 * THE BANNER TAB IS A GEOMETRY REPLICA, NOT `AppShell`, and that is a real
 * limitation rather than a shortcut. `AppShell` mounts `AlertsBadge` and
 * `OrgSwitcher`, both of which query Convex — and /design-system is a PUBLIC
 * route (proxy.ts) with no session, so mounting it here throws. That is not
 * hypothetical: it is why `app/design-system/shell/page.tsx` fails to load
 * today, before any of this slice's changes.
 *
 * So the tab below reproduces the three class strings that carry the shell's
 * geometry, VERBATIM, and `components/shell/banner-geometry.test.ts` asserts
 * they are still identical to the ones in app-shell.tsx. A replica that can
 * drift silently would be worse than no replica; one that fails the build
 * when it drifts is worth having.
 */

const ROWS: AdminOrgRow[] = [
  {
    orgId: "org_a",
    name: "Rutendo's Kitchen",
    slug: "rutendos-kitchen",
    createdAt: new Date("2026-02-11").getTime(),
    membersCount: 2,
    provisioned: true,
    plan: "free",
    foundingMember: true,
    disabled: false,
    ordersThisMonth: 34,
  },
  {
    orgId: "org_b",
    name: "Sadza & Sons",
    slug: "sadza-and-sons",
    createdAt: new Date("2026-05-02").getTime(),
    membersCount: 4,
    provisioned: true,
    plan: "standard",
    foundingMember: false,
    disabled: false,
    ordersThisMonth: 112,
  },
  {
    orgId: "org_c",
    name: "Tariro Bakes",
    slug: "tariro-bakes",
    createdAt: new Date("2026-06-20").getTime(),
    membersCount: 1,
    provisioned: true,
    plan: "free",
    foundingMember: false,
    disabled: true,
    ordersThisMonth: 0,
  },
  {
    orgId: "org_d",
    name: "Chipo's Pies",
    slug: "chipos-pies",
    createdAt: new Date("2026-08-05").getTime(),
    membersCount: 1,
    provisioned: false,
    plan: null,
    foundingMember: null,
    disabled: null,
    ordersThisMonth: 0,
  },
];

const HISTORY: ImpersonationRow[] = [
  {
    id: "s1",
    superUserId: "user_super",
    startedAt: new Date("2026-08-05T14:02:00").getTime(),
    endedAt: new Date("2026-08-05T14:19:00").getTime(),
  },
  {
    id: "s2",
    superUserId: "user_super",
    startedAt: new Date("2026-07-28T09:31:00").getTime(),
    // Nobody pressed stop; it lapsed against the 30-minute cap. Shown as
    // "left open" rather than smoothed into a fake end time.
    endedAt: null,
  },
];

/** The strip, without the Convex mutation the real one carries. */
function BannerSpecimen() {
  return (
    <div className="flex h-14 items-center justify-between gap-3 overflow-hidden border-b bg-foreground px-4 text-background md:px-6">
      <p className="type-label flex min-w-0 items-center gap-1.5">
        <Eye aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
        <span className="shrink-0">Read-only ·</span>
        <span className="min-w-0 truncate font-semibold">
          Rutendo&rsquo;s Kitchen
        </span>
        <span className="hidden shrink-0 sm:inline">
          until <span className="numeric">2:34 PM</span>
        </span>
      </p>
      <button
        type="button"
        className="type-label inline-flex min-h-11 shrink-0 items-center md:min-h-9 rounded-md border border-background/30 px-3 transition-[background-color,transform] duration-[var(--duration-fast)] ease-out hover:bg-background/10 active:scale-[0.97]"
      >
        Stop viewing
      </button>
    </div>
  );
}

/**
 * The shell's geometry, reproduced exactly.
 *
 * Every className below is copied character-for-character from
 * components/shell/app-shell.tsx and is asserted identical by
 * banner-geometry.test.ts. The point is that the three offsets can be MEASURED here:
 * the strip is sticky at the top, the fixed mobile bar sits at
 * top-[var(--banner-h)] rather than under the strip, and the sidebar is
 * exactly the strip's height short of the viewport.
 */
function ShellGeometry() {
  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{ "--banner-h": "3.5rem" } as React.CSSProperties}
    >
      <div className="sticky top-0 z-50">
        <BannerSpecimen />
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="sticky top-[var(--banner-h)] hidden h-[calc(100dvh-var(--banner-h))] w-60 shrink-0 flex-col border-r bg-card md:flex">
          <div className="px-5 pt-5 pb-2">
            <p className="type-flourish text-primary" aria-hidden>
              Sous
            </p>
          </div>
          <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-3 py-2">
            {["Home", "Orders", "Calendar", "Menu", "Pantry"].map((label) => (
              <span key={label} className="rounded-md px-3 py-2 type-label text-muted-foreground">
                {label}
              </span>
            ))}
          </nav>
        </aside>

        <div className="fixed inset-x-0 top-[var(--banner-h)] z-40 flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
          <p className="type-flourish text-primary" aria-hidden>
            Sous
          </p>
        </div>

        <main id="main" className="min-w-0 flex-1 px-4 pt-18 pb-32 md:px-6 md:pt-8 md:pb-8">
          <div className="flex flex-col gap-4">
            <h1 className="type-display">Home</h1>
            <p className="type-body text-pretty text-muted-foreground">
              Her kitchen, seen by somebody who is not her. Everything reads;
              nothing writes — and that is enforced in
              convex/lib/functions.ts, not by hiding buttons here.
            </p>
            <div className="h-[70vh] rounded-lg border bg-card" />
            <p className="type-caption text-muted-foreground">
              Scroll: the strip stays. A banner that leaves the screen is not
              persistent, and thirty minutes is long enough to forget whose
              margins these are.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

const STATES = {
  list: "The console",
  detail: "One kitchen",
  unprovisioned: "In Clerk, no Sous row",
  provision: "Creating a kitchen",
  banner: "The impersonation banner, and the offsets it forces",
  empty: "Before the first kitchen",
} as const;

type StateKey = keyof typeof STATES;

export default function AdminSpecimenPage() {
  const [key, setKey] = React.useState<StateKey>("list");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const open =
    key === "detail"
      ? ROWS[0]
      : key === "unprovisioned"
        ? ROWS[3]
        : (ROWS.find((r) => r.orgId === openId) ?? null);

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Admin specimen — sample data, nothing saves
        </p>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 md:w-auto">
          {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto,
              so without it the wrapper grows to its content and
              overflow-x-auto has nothing left to constrain. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Tabs value={key} onValueChange={(v) => setKey(v as StateKey)}>
              <TabsList>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="detail">Detail</TabsTrigger>
                <TabsTrigger value="unprovisioned">Unprovisioned</TabsTrigger>
                <TabsTrigger value="provision">New</TabsTrigger>
                <TabsTrigger value="banner">Banner</TabsTrigger>
                <TabsTrigger value="empty">Empty</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ModeToggle />
        </div>
      </div>

      {key === "banner" ? (
        <ShellGeometry />
      ) : (
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 md:px-6 md:py-12">
          <p className="type-caption text-pretty text-muted-foreground">
            {STATES[key]}. Tiers are invisible to kitchens and enforce nothing;
            the counters run anyway, so that a limit set in six months is based
            on what actually happened rather than on a guess.
          </p>

          {key === "provision" && (
            <ProvisionForm
              busy={false}
              error={null}
              notice={null}
              onSubmit={() => {}}
            />
          )}

          {(key === "list" || key === "detail" || key === "unprovisioned") && (
            <OrgTable rows={ROWS} onOpen={(row) => setOpenId(row.orgId)} />
          )}

          {key === "empty" && <OrgTable rows={[]} onOpen={() => {}} />}

          <OrgDetail
            row={open}
            history={open?.provisioned ? HISTORY : []}
            busy={false}
            error={null}
            onClose={() => {
              setOpenId(null);
              if (key === "detail" || key === "unprovisioned") setKey("list");
            }}
            onPlan={() => {}}
            onFoundingMember={() => {}}
            onDisabled={() => {}}
            onImpersonate={() => {}}
            onFinishProvisioning={() => {}}
          />
        </main>
      )}
    </div>
  );
}
