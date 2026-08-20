"use client";

import * as React from "react";
import { Check, Undo2 } from "lucide-react";
import { usePalette } from "@/components/theme/theme-provider";
import {
  resolvePalette,
  toHex,
  type OrgPalette,
} from "@/lib/theme/derive";
import type { GuardSuggestion, PaletteSlot } from "@/lib/theme/contrast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The org colour picker with its live contrast guard. DESIGN.md §2.
 *
 * Colour 1 is mandatory; 2 and 3 are optional and derived when absent. The
 * guard runs on every change, on the surfaces the colours will actually land
 * on, in both modes. Failures speak plain language and offer the nearest
 * passing shade in the same gesture. Committing is disabled while anything
 * fails — there is no "save anyway".
 */

const SLOTS: {
  slot: PaletteSlot;
  title: string;
  detail: string;
  optional: boolean;
}[] = [
  {
    slot: "primary",
    title: "Your main colour",
    detail: "Buttons, links and highlights.",
    optional: false,
  },
  {
    slot: "accent",
    title: "A second colour",
    detail: "Chips, tags and chart lines.",
    optional: true,
  },
  {
    slot: "tint",
    title: "A background tint",
    detail: "The paper everything sits on.",
    optional: true,
  },
];

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

function normalizeHex(value: string): string | null {
  const match = HEX_RE.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

export function OrgColorPicker({
  onCommit,
}: {
  onCommit?: (palette: OrgPalette) => void;
}) {
  const { palette, setPalette, guard } = usePalette();
  const [hexDrafts, setHexDrafts] = React.useState<
    Partial<Record<PaletteSlot, string>>
  >({});

  const resolved = resolvePalette(palette);

  const update = (slot: PaletteSlot, value: string | null) => {
    setHexDrafts((d) => ({ ...d, [slot]: undefined }));
    setPalette({ ...palette, [slot]: value });
  };

  const applySuggestion = (s: GuardSuggestion) => update(s.slot, s.hex);

  return (
    <div className="flex flex-col gap-6">
      {SLOTS.map(({ slot, title, detail, optional }) => {
        const picked = palette[slot] ?? null;
        const derivedHex =
          !picked && resolved
            ? toHex(
                slot === "accent"
                  ? resolved.accent
                  : slot === "tint"
                    ? resolved.tint
                    : resolved.primary,
              )
            : null;
        const shown = picked ?? derivedHex ?? "#888888";
        const failures = guard?.failures.filter((f) => f.slot === slot) ?? [];
        const suggestion = guard?.suggestions.find((s) => s.slot === slot);
        const flags = guard?.proximityFlags.filter((f) => f.slot === slot) ?? [];
        const inputId = `org-color-${slot}`;

        return (
          <div key={slot} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                {/* One child span: Label is a flex container, and separate
                    text nodes would wrap apart as flex items on mobile. */}
                <Label htmlFor={inputId} className="type-label">
                  <span>
                    {title}
                    {optional && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        — optional
                      </span>
                    )}
                  </span>
                </Label>
                <p className="type-caption text-muted-foreground mt-0.5">
                  {detail}
                </p>
              </div>
              {optional && picked && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update(slot, null)}
                >
                  <Undo2 aria-hidden data-icon="inline-start" />
                  Let Sous choose
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <label
                className={cn(
                  "relative block size-11 shrink-0 cursor-pointer overflow-hidden rounded-md border",
                  failures.length > 0 && "border-loss ring-2 ring-loss/30",
                )}
                style={{ backgroundColor: shown }}
              >
                <span className="sr-only">{title} swatch</span>
                <input
                  type="color"
                  value={shown}
                  aria-label={`${title} — pick from a colour wheel`}
                  onChange={(e) => update(slot, e.target.value)}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
              </label>
              <Input
                id={inputId}
                value={hexDrafts[slot] ?? picked ?? ""}
                placeholder={derivedHex ?? "#2E6158"}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={failures.length > 0 || undefined}
                className="w-32 numeric-body"
                onChange={(e) => {
                  const raw = e.target.value;
                  setHexDrafts((d) => ({ ...d, [slot]: raw }));
                  const hex = normalizeHex(raw);
                  if (hex) setPalette({ ...palette, [slot]: hex });
                }}
                onBlur={() => setHexDrafts((d) => ({ ...d, [slot]: undefined }))}
              />
              {!picked && optional && (
                <p className="type-caption text-muted-foreground">
                  Filled in from your first colour.
                </p>
              )}
            </div>

            <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
              {suggestion && (
                <div className="bg-loss-soft rounded-md p-3">
                  <p className="type-label text-loss-foreground">
                    {suggestion.message}
                  </p>
                  <button
                    type="button"
                    onClick={() => applySuggestion(suggestion)}
                    className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border bg-card px-3 type-label"
                  >
                    <span
                      aria-hidden
                      className="size-5 rounded-sm border"
                      style={{ backgroundColor: suggestion.hex }}
                    />
                    Use {suggestion.hex}
                  </button>
                </div>
              )}
              {flags.map((flag, i) => (
                <p key={i} className="bg-warn-soft text-warn-foreground rounded-md p-3 type-label">
                  {flag.message}
                </p>
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-3 border-t pt-4">
        <Button
          disabled={!guard?.ok}
          onClick={() => onCommit?.(palette)}
        >
          <Check aria-hidden data-icon="inline-start" />
          Keep these colours
        </Button>
        {!guard?.ok && (
          <p className="type-caption text-muted-foreground">
            Fix the flagged colour first — Sous won&apos;t save a palette it
            can&apos;t read.
          </p>
        )}
      </div>
    </div>
  );
}
