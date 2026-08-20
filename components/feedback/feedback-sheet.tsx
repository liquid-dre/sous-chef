"use client";

import * as React from "react";
import { MessageSquareHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  FLAG_LABEL,
  type FeedbackFlag,
  type SensoryAxis,
} from "@/convex/lib/feedback";
import { cn } from "@/lib/utils";
import { DivergingScale } from "./diverging-scale";

/**
 * Her path, and the primary one.
 *
 * CONTEXT.md is blunt about why: a realistic survey response rate is 10–30%,
 * so her own notes will outnumber the form five to one. If logging what a
 * customer said is slower than remembering it, it does not get logged, and the
 * public form alone would give Sous a sample too thin to say anything.
 *
 * So: ONE TAP opens this from the order row. Nothing is pre-selected, every
 * field is optional, and a single line of remembered text is a complete and
 * saveable entry. She is standing in a kitchen recalling a comment from
 * yesterday — a form that demands a full set of ratings gets abandoned, and an
 * abandoned form records nothing at all.
 *
 * Drawer on mobile, popover on desktop, exactly as components/shell/
 * quick-action.tsx does it — the same body rendered into whichever container
 * the pointer deserves.
 */

export interface SheetItem {
  menuItemId: string;
  name: string;
  axes: SensoryAxis[];
}

const FLAGS: FeedbackFlag[] = ["tooExpensive", "late", "packaging", "lovedIt"];

export function FeedbackSheet({
  customerName,
  items,
  onSave,
  triggerClassName,
}: {
  customerName: string;
  /** Only items with axes. An item she has not set up is not asked about. */
  items: SheetItem[];
  onSave: (input: {
    menuItemId?: string;
    axisRatings: { axis: SensoryAxis; value: number }[];
    flags: FeedbackFlag[];
    freeText?: string;
  }) => Promise<void>;
  triggerClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [itemIndex, setItemIndex] = React.useState(0);
  const [ratings, setRatings] = React.useState<Record<string, number | null>>({});
  const [flags, setFlags] = React.useState<FeedbackFlag[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const item = items[itemIndex];
  const picked = item
    ? item.axes
        .map((axis) => ({ axis, value: ratings[axis] }))
        .filter((r): r is { axis: SensoryAxis; value: number } => r.value != null)
    : [];
  const empty = picked.length === 0 && flags.length === 0 && text.trim() === "";

  const reset = () => {
    setRatings({});
    setFlags([]);
    setText("");
    setError(null);
    setSaved(false);
  };

  const close = () => {
    setOpen(false);
    // Cleared on the way out rather than the way in, so the closing animation
    // does not play over a form emptying itself.
    setTimeout(reset, 200);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        menuItemId: picked.length > 0 ? item?.menuItemId : undefined,
        axisRatings: picked,
        flags,
        freeText: text.trim() || undefined,
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  const body = (compact = false) => {
    if (saved) {
      return (
        <div className="flex flex-col gap-3 p-4">
          <p className="type-body">Noted against this order.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={reset}>
              Add another
            </Button>
            <Button size="sm" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className={cn("flex flex-col gap-4 p-4", compact && "gap-3 p-2")}>
        <p className="type-caption text-muted-foreground">
          What did {customerName} say? Anything you remember — a word is enough.
        </p>

        {items.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {items.map((option, index) => (
              <button
                key={option.menuItemId}
                type="button"
                aria-pressed={index === itemIndex}
                onClick={() => {
                  setItemIndex(index);
                  setRatings({});
                }}
                className={cn(
                  "min-h-9 rounded-full border px-3 type-label outline-none",
                  "transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-out",
                  index === itemIndex
                    ? "border-primary bg-primary-soft text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {option.name}
              </button>
            ))}
          </div>
        )}

        {item && (
          <div className="flex flex-col gap-4">
            {item.axes.map((axis) => (
              <DivergingScale
                key={axis}
                axis={axis}
                value={ratings[axis] ?? null}
                onChange={(value) =>
                  setRatings((r) => ({ ...r, [axis]: value }))
                }
                idPrefix="chef-"
              />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="type-label">Anything else</span>
          <div className="flex flex-wrap gap-1.5">
            {FLAGS.map((flag) => {
              const on = flags.includes(flag);
              return (
                <button
                  key={flag}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setFlags((f) =>
                      on ? f.filter((x) => x !== flag) : [...f, flag],
                    )
                  }
                  className={cn(
                    "min-h-11 rounded-full border px-3 type-label outline-none",
                    "transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] ease-out",
                    "focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
                    on
                      ? "border-primary bg-primary-soft text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {FLAG_LABEL[flag]}
                </button>
              );
            })}
          </div>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="In their words, if you remember it"
          aria-label="What they said"
        />

        {error && (
          <p className="type-caption text-loss" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy || empty} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  const trigger = (
    <>
      <MessageSquareHeart aria-hidden className="size-4" /> Log feedback
    </>
  );
  const triggerClass = cn(
    "inline-flex min-h-11 items-center gap-2 rounded-md border bg-card px-3 type-label text-muted-foreground outline-none",
    "transition-[background-color,color,transform] duration-[var(--duration-fast)] ease-out",
    "hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
    "md:min-h-9",
    triggerClassName,
  );

  return (
    <>
      <div className="md:hidden">
        <Drawer open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
          <DrawerTrigger className={triggerClass}>{trigger}</DrawerTrigger>
          <DrawerContent
            // The global drawer token is 260ms; this instance overrides the
            // variable the vaul rule reads so it lands under 250.
            style={{ "--duration-drawer": "240ms" } as React.CSSProperties}
          >
            <DrawerHeader>
              <DrawerTitle>Log feedback</DrawerTitle>
            </DrawerHeader>
            <div className="max-h-[70dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              {body()}
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      <div className="hidden md:block">
        <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
          <PopoverTrigger className={triggerClass}>{trigger}</PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            className="max-h-[70dvh] w-96 overflow-y-auto p-0"
          >
            {body(true)}
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
