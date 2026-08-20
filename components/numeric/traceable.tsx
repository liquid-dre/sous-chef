"use client";

import * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Money, Margin } from "@/components/numeric/money";
import { cn } from "@/lib/utils";

/**
 * Every derived number is traceable. DESIGN.md §4.
 *
 * Tapping a margin reveals the layers that produced it. She will not trust a
 * number she cannot take apart — a derived number with no breakdown
 * affordance is a defect.
 */

export interface CostLayer {
  label: string;
  amount: number;
}

export function TraceableMargin({
  ratio,
  price,
  layers,
  /** Which layers this margin is measured against. */
  kind,
  size = "body",
  className,
}: {
  ratio: number;
  price: number;
  layers: CostLayer[];
  kind: "gross" | "net";
  size?: "sm" | "body" | "lg" | "xl";
  className?: string;
}) {
  const totalCost = layers.reduce((sum, layer) => sum + layer.amount, 0);
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex min-h-11 items-center rounded-sm underline decoration-dotted decoration-muted-foreground/60 underline-offset-4",
          className,
        )}
        aria-label={`${kind === "gross" ? "Gross" : "Net"} margin ${Math.round(ratio * 100)} percent — tap for the layers behind it`}
      >
        <Margin ratio={ratio} size={size} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-4">
        <p className="type-label text-muted-foreground">
          {kind === "gross" ? "Gross margin" : "Net margin"} — the layers behind
          it
        </p>
        <dl className="mt-3 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-body">Price</dt>
            <dd>
              <Money amount={price} />
            </dd>
          </div>
          {layers.map((layer) => (
            <div
              key={layer.label}
              className="flex items-baseline justify-between gap-4"
            >
              <dt className="type-body text-muted-foreground">{layer.label}</dt>
              <dd>
                <Money amount={-layer.amount} />
              </dd>
            </div>
          ))}
        </dl>
        <Separator className="my-3" />
        <div className="flex items-baseline justify-between gap-4">
          <span className="type-label">Left over</span>
          <Money
            amount={price - totalCost}
            className={cn(price - totalCost >= 0 && "text-profit")}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
