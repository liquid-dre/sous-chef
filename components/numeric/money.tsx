import { cn } from "@/lib/utils";

/**
 * Numeric display rules. DESIGN.md §4 — this section outranks every other.
 *
 * Money: always 2dp, always with the symbol, never abbreviated where she might
 * act on it. Negative money is red AND parenthesised — colour alone fails
 * colourblind users and fails in a WhatsApp screenshot. Margins: 0dp with %.
 * Everything renders in the numeric (tabular) face.
 */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number): string {
  const absolute = usd.format(Math.abs(amount));
  return amount < 0 ? `(${absolute})` : absolute;
}

type NumericSize = "sm" | "body" | "lg" | "xl";

const sizeClass: Record<NumericSize, string> = {
  sm: "numeric-sm",
  body: "numeric-body",
  lg: "numeric-lg",
  xl: "numeric-xl",
};

export function Money({
  amount,
  size = "body",
  className,
}: {
  amount: number;
  size?: NumericSize;
  className?: string;
}) {
  return (
    <span
      className={cn(sizeClass[size], amount < 0 && "text-loss", className)}
    >
      {formatMoney(amount)}
    </span>
  );
}

export function Margin({
  /** e.g. 0.62 for 62% */
  ratio,
  size = "body",
  className,
}: {
  ratio: number;
  size?: NumericSize;
  className?: string;
}) {
  const percent = Math.round(ratio * 100);
  return (
    <span
      className={cn(sizeClass[size], percent < 0 && "text-loss", className)}
    >
      {percent}%
    </span>
  );
}
