"use client";

import * as React from "react";
import { House } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { navForRole } from "@/components/shell/nav";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Role } from "@/lib/auth/org";

/**
 * Shell specimen for grading against DESIGN.md — the same AppShell the
 * authenticated app renders, with sample props and no session. Clerk-backed
 * widgets (org switcher list, user button) stay in their unloaded state here;
 * everything else is real.
 */
export default function ShellSpecimenPage() {
  const [role, setRole] = React.useState<Role>("owner");
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="sticky top-0 z-50 flex items-center justify-between gap-4 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Shell specimen — no session, sample data
        </p>
        <Tabs value={role} onValueChange={(v) => setRole(v as Role)}>
          <TabsList>
            <TabsTrigger value="owner">Owner</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {/* items are role-filtered here exactly as the server layout does it —
          switch to Staff and the other six items leave props and DOM. */}
      <AppShell
        orgSlug="kitchen-a"
        orgName="Rutendo's Kitchen"
        items={navForRole(role)}
      >
        <EmptyState
          icon={House}
          title="The truth about the money will live here"
          body="Once orders and purchases start flowing, Home shows whether you're making money — gross and net margin, side by side."
        />
        <div className="mx-auto flex max-w-2xl flex-col gap-2 border-t pt-6">
          <p className="type-label">Alerts badge specimens (static)</p>
          <div className="flex items-center gap-4">
            <span className="numeric inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-warn px-1 text-caption font-semibold text-[oklch(0.2_0.02_75)]">
              3
            </span>
            <span className="numeric inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-loss px-1 text-caption font-semibold text-white">
              9+
            </span>
            <span className="type-caption text-muted-foreground">
              The live badge renders nothing until real alert data exists —
              absence, not a zero.
            </span>
          </div>
        </div>
      </AppShell>
    </div>
  );
}
