"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useClientToday } from "@/components/use-client-today";
import {
  PERIODS,
  boundsFor,
  boundsForDay,
  type PeriodBounds,
  type PeriodKey,
} from "@/lib/period";

/**
 * One period switcher per view; every chart in it listens (grilled:
 * calendar-anchored, her words). Bounds are domain-day strings matching the
 * schema. Switched constantly — so it never animates, per DESIGN.md §6.
 * On mobile this replaces Bklit's Brush entirely; Brush is desktop-only.
 *
 * The arithmetic lives in lib/period.ts so a server component can compute the
 * same window — see PeriodProvider's `serverDay`.
 */

export { PERIODS, boundsFor, filterByPeriod } from "@/lib/period";
export type { PeriodBounds, PeriodKey } from "@/lib/period";

interface PeriodContextValue {
  period: PeriodKey;
  setPeriod: (key: PeriodKey) => void;
  bounds: PeriodBounds;
  label: string;
}

const PeriodContext = React.createContext<PeriodContextValue | null>(null);

export function usePeriod(): PeriodContextValue {
  const ctx = React.useContext(PeriodContext);
  if (!ctx) throw new Error("usePeriod must be used within PeriodProvider");
  return ctx;
}

export function PeriodProvider({
  defaultPeriod = "month",
  /**
   * The day the SERVER used, when it pre-rendered something for this view.
   *
   * useClientToday returns "" during the server render and during hydration
   * (that is what its getServerSnapshot is for), so on both of those passes we
   * fall back to this and the markup matches exactly. React then re-renders
   * with her real day, which is the same string in every case except a stale
   * timezone cookie.
   */
  serverDay,
  children,
}: {
  defaultPeriod?: PeriodKey;
  serverDay?: string;
  children: React.ReactNode;
}) {
  const [period, setPeriod] = React.useState<PeriodKey>(defaultPeriod);
  const clientDay = useClientToday();
  const day = clientDay || serverDay || "";
  const value = React.useMemo(
    () => ({
      period,
      setPeriod,
      bounds: day ? boundsForDay(period, day) : boundsFor(period),
      label: PERIODS.find((p) => p.key === period)?.label ?? "",
    }),
    [period, day],
  );
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

/** Segmented control, 44px targets on touch, zero animation. */
export function PeriodSwitcher({ className }: { className?: string }) {
  const { period, setPeriod } = usePeriod();
  return (
    <div
      role="group"
      aria-label="Period"
      className={cn(
        "flex w-fit max-w-full items-stretch gap-0.5 overflow-x-auto rounded-md border bg-card p-0.5",
        className,
      )}
    >
      {PERIODS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          aria-pressed={period === key}
          onClick={() => setPeriod(key)}
          className={cn(
            "min-h-10 shrink-0 rounded-sm px-3 type-label whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-8",
            period === key
              ? "bg-primary-soft text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
