"use client";

import * as React from "react";
import Link from "next/link";
import { BellOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { AlertCard, type AlertRow } from "./alert-card";
import { RunwayBars, type RunwayRow } from "./runway-bars";
import type { PantryTrust } from "@/convex/lib/alerts";

/**
 * The alerts screen, free of Convex so the specimen can mount it.
 *
 * Three things the shape is deliberately built around:
 *
 * 1. **No bulk close.** Every alert carries its own button. The scope is
 *    explicit — she must be able to clear one in the middle without touching
 *    the ones around it — and a "clear all" would make resolving mean
 *    "silence everything" rather than "I have dealt with that".
 * 2. **Dormant replaces the list with one line.** Eleven alerts built on a
 *    fortnight of unverified arithmetic is the same trust leak as two wrong
 *    reds, only slower (CONTEXT.md).
 * 3. **Mute controls live HERE**, not buried in Settings, because this is
 *    where she is when she decides she has heard enough about the flour.
 */

export type SeverityFilter = "all" | "red" | "amber";

const FILTERS: { value: SeverityFilter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "red", label: "Short now" },
  { value: "amber", label: "Getting low" },
];

export interface AlertsScreenData {
  open: AlertRow[];
  suppressed: { subjectKey: string; name: string }[];
  resolved: {
    id: string;
    severity: "red" | "amber";
    message: string;
    resolvedAt: number;
  }[];
  runways: RunwayRow[];
  trust: PantryTrust;
  daysSinceCount: number | null;
  orderCount: number;
  demandBatches: number;
  horizonEnd: string;
  horizonDays: number;
  globallyMuted: boolean;
  mutedIngredients: { id: string; name: string }[];
  counts: { red: number; amber: number };
}

function whenResolved(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function AlertsScreen({
  data,
  filter,
  onFilterChange,
  onResolve,
  onUnresolve,
  onMuteIngredient,
  onUnmuteIngredient,
  onGlobalMute,
  busy,
  stocktakeHref,
}: {
  data: AlertsScreenData;
  filter: SeverityFilter;
  onFilterChange: (next: SeverityFilter) => void;
  onResolve: (row: AlertRow, message: string) => void;
  onUnresolve: (id: string) => void;
  onMuteIngredient: (ingredientId: string) => void;
  onUnmuteIngredient: (ingredientId: string) => void;
  onGlobalMute: (muted: boolean) => void;
  busy?: boolean;
  stocktakeHref: string;
}) {
  const shown =
    filter === "all" ? data.open : data.open.filter((a) => a.severity === filter);
  const dormant = data.trust === "dormant";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-display">Alerts</h1>
          <p className="type-body text-muted-foreground">
            {data.orderCount === 0
              ? "Nothing is booked in the next week."
              : `${data.orderCount} ${data.orderCount === 1 ? "order" : "orders"} before ${data.horizonEnd}, needing ${data.demandBatches} ${data.demandBatches === 1 ? "batch" : "batches"}.`}
          </p>
        </div>
      </div>

      {/* Dormant: ONE line, and the per-ingredient list does not render at
          all. CONTEXT.md — "two missed stocktakes puts alerts dormant and the
          dashboard says so". */}
      {dormant && (
        <section
          aria-label="Alerts are dormant"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warn-soft p-4 text-warn-foreground"
        >
          <p className="type-body min-w-40 flex-1 text-pretty">
            Two stocktakes have been missed, so Sous has stopped raising pantry
            alerts rather than raising wrong ones. The amounts below are still
            here — they are just arithmetic nobody has confirmed.
          </p>
          {/* next/link, not a bare anchor: an <a> here is a full document
              reload that loses her scroll position and re-downloads the
              bundle to reach a route the router already holds. */}
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-9" asChild>
            <Link href={stocktakeHref}>Take a stocktake</Link>
          </Button>
        </section>
      )}

      {data.globallyMuted && (
        <p className="type-caption rounded-lg border bg-card p-3 text-muted-foreground">
          Alerts are muted for the whole kitchen. Sous is still working them
          out — it just is not telling you.
        </p>
      )}

      {!dormant && (
        <>
          <div
            className="flex min-w-0 gap-1 overflow-x-auto"
            role="group"
            aria-label="Which alerts"
          >
            {FILTERS.map((f) => {
              const count =
                f.value === "all"
                  ? data.counts.red + data.counts.amber
                  : data.counts[f.value];
              return (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={filter === f.value}
                  // The visible label puts the count in its own span, which
                  // reads as "Everything2" to anything that concatenates text
                  // nodes. Spelt out here so the pill is sayable.
                  aria-label={`${f.label}, ${count} ${count === 1 ? "alert" : "alerts"}`}
                  onClick={() => onFilterChange(f.value)}
                  className={cn(
                    "min-h-11 shrink-0 rounded-full border px-4 type-label outline-none transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-9",
                    filter === f.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {f.label}
                  {/* Counts come from BEFORE filtering, so the pills do not
                      shrink as she uses them. */}
                  <span className="numeric ml-1.5">{count}</span>
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={
                data.open.length === 0
                  ? "Nothing needs your attention"
                  : "Nothing in this filter"
              }
              body={
                data.open.length === 0
                  ? "Sous checked your booked orders against the pantry and everything is covered. It will say so here the moment that changes."
                  : "Switch back to Everything to see the rest."
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((row) => (
                <AlertCard
                  key={row.subjectKey}
                  row={row}
                  orderCount={data.orderCount}
                  demandBatches={data.demandBatches}
                  horizonEnd={data.horizonEnd}
                  trust={data.trust}
                  busy={busy}
                  onResolve={(message) => onResolve(row, message)}
                  onMute={() => onMuteIngredient(row.subjectId)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <RunwayBars
        rows={data.runways}
        trust={data.trust}
        daysSinceCount={data.daysSinceCount}
      />

      {/* Suppressed by her own resolution — shown, never silently dropped, so
          "why am I not being told about the milk?" has an answer on screen. */}
      {data.suppressed.length > 0 && (
        <section
          aria-label="You have dealt with these"
          className="flex flex-col gap-2 rounded-lg border bg-card p-4"
        >
          <h2 className="type-label text-muted-foreground">
            You said you had dealt with these
          </h2>
          <p className="type-caption text-muted-foreground">
            Still short, but quiet because you told Sous. They come back if it
            gets materially worse.
          </p>
          <ul className="flex flex-col gap-1">
            {data.suppressed.map((s) => (
              <li key={s.subjectKey} className="type-body">
                {s.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-label="Muting"
        className="flex flex-col gap-4 rounded-lg border bg-card p-4"
      >
        <h2 className="type-title">What Sous tells you</h2>
        <div className="flex items-center gap-2.5">
          <Switch
            id="global-mute"
            checked={!data.globallyMuted}
            onCheckedChange={(v) => onGlobalMute(!v)}
          />
          <Label htmlFor="global-mute">
            Tell me about the pantry
            <span className="type-caption ml-2 text-muted-foreground">
              costing and the runway are unaffected either way
            </span>
          </Label>
        </div>

        {data.mutedIngredients.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="type-label text-muted-foreground">
              Muted ingredients
            </p>
            <ul className="flex flex-wrap gap-2">
              {data.mutedIngredients.map((i) => (
                <li key={i.id}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 gap-1.5 md:min-h-9"
                    onClick={() => onUnmuteIngredient(i.id)}
                  >
                    <BellOff aria-hidden className="size-3.5" />
                    {i.name}
                    <span className="type-caption text-muted-foreground">
                      unmute
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {data.resolved.length > 0 && (
        <section
          aria-label="Resolved"
          className="flex flex-col gap-2 rounded-lg border bg-card p-4"
        >
          <h2 className="type-title">Already handled</h2>
          <ul className="flex flex-col divide-y">
            {data.resolved.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2"
              >
                <span className="min-w-40 flex-1">
                  {/* The message she SAW, not a re-derivation of what today's
                      data would say. */}
                  <span className="type-body">{r.message}</span>
                  <span className="type-caption block text-muted-foreground">
                    {whenResolved(r.resolvedAt)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 md:min-h-9"
                  onClick={() => onUnresolve(r.id)}
                >
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
