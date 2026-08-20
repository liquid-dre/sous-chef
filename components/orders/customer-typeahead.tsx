"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { phoneDigits } from "@/lib/phone";

/**
 * Three letters of a name, or three digits of a phone, and everything else
 * fills itself in. This is the single biggest lever on the tap budget: a
 * repeat customer costs one tap, not a form.
 *
 * Structure follows the pantry's ingredient typeahead — no debounce, results
 * from the first keystroke, one `highlight` integer covering both matches and
 * the create row. Two details there are load-bearing and copied deliberately:
 * the 120ms blur delay (so a tap on a result lands before the list closes),
 * and `onMouseDown` preventDefault on each option (so the blur never fires
 * first and eats the tap).
 */

export interface CustomerOption {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
}

export interface CustomerValue {
  customerId?: string;
  /** What's in the box. */
  label: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
}

export function CustomerTypeahead({
  value,
  options,
  onChange,
  autoFocus,
  onCommit,
}: {
  value: CustomerValue;
  /** Already filtered by the server; filtered again here so the list tracks
   * her typing without waiting for a round trip. */
  options: CustomerOption[];
  onChange: (value: CustomerValue) => void;
  autoFocus?: boolean;
  onCommit?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const term = value.label;

  const matches = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    const digits = phoneDigits(term);
    return options
      .filter(
        (o) =>
          o.name.toLowerCase().includes(needle) ||
          (digits.length > 0 && phoneDigits(o.phone).includes(digits)),
      )
      .slice(0, 6);
  }, [options, term]);

  const resolved = value.customerId != null;
  const rows = matches.length;

  const pick = (option: CustomerOption) => {
    onChange({
      customerId: option.id,
      label: option.name,
      name: option.name,
      phone: option.phone,
      email: option.email,
      address: option.address,
    });
    setOpen(false);
    onCommit?.();
  };

  return (
    <div className="relative">
      <Input
        value={term}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && rows > 0}
        aria-label="Customer"
        autoComplete="off"
        placeholder="Name or phone"
        onChange={(e) => {
          // No debounce: she should see her regulars from the first letter.
          // Typing again clears the resolution — the box and the record must
          // never disagree about who this is.
          onChange({ label: e.target.value, name: e.target.value, phone: value.phone });
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => term && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || rows === 0) {
            if (e.key === "Enter") onCommit?.();
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % rows);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + rows) % rows);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(matches[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {resolved && (
        <span className="type-caption absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
          on file
        </span>
      )}

      {open && rows > 0 && (
        <ul
          role="listbox"
          className="animate-in fade-in-0 zoom-in-95 absolute top-full left-0 z-50 mt-1 w-full min-w-56 origin-top overflow-hidden rounded-md border bg-popover shadow-float duration-[var(--duration-fast)] ease-out"
        >
          {matches.map((option, i) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                // Without this the input's blur fires first and closes the
                // list before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left md:min-h-9",
                  i === highlight && "bg-muted",
                )}
              >
                <span className="type-body min-w-0 truncate">{option.name}</span>
                <span className="numeric-sm shrink-0 text-muted-foreground">
                  {option.phone}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
