"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Money and percent fields with their symbol sitting inside the box.
 *
 * The `md:` twins on the padding are not decoration and must not be tidied
 * away: the Input base sets `md:px-2.5`, and a media-query variant beats a
 * bare `pl-7`, so without the twin the `$` lands on top of the digits at
 * desktop widths. This was measured, not guessed.
 *
 * Lifted out of business-profile.tsx, where both were private, so the order
 * form uses the same fields rather than a fourth copy that drifts.
 */

export function MoneyInput({
  id,
  value,
  onChange,
  suffix,
  disabled,
  placeholder,
  className,
  "aria-label": ariaLabel,
  onKeyDown,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <div className={cn("relative", className)}>
      <span className="numeric-sm pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
        $
      </span>
      <Input
        id={id}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        inputMode="decimal"
        placeholder={placeholder ?? "0.00"}
        disabled={disabled}
        className={cn("numeric-body pl-7 md:pl-7", suffix && "pr-16 md:pr-16")}
      />
      {suffix && (
        <span className="type-caption pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function PercentInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder={placeholder ?? "0"}
        disabled={disabled}
        className="numeric-body pr-8 md:pr-8"
      />
      <span className="numeric-sm pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
        %
      </span>
    </div>
  );
}
