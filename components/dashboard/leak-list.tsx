import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatMoneyExact } from "@/components/charts-sous/format";

/**
 * The single largest thing hurting the number above, then the rest in order
 * behind it.
 *
 * It FLAGS. It never instructs. "Cupcakes: 8% of production hours, 2% of
 * profit" — she draws the conclusion. Chefs keep items for reasons Sous has no
 * access to, and an app that tells her to drop one gets closed (CONTEXT.md).
 *
 * This list is also the Sankey's tap targets. The vendored Sankey has no click
 * handlers at all — every branch there is hover-only — so the ranking that the
 * branch widths draw is repeated here as real links, in the same order, which
 * is the version that works on a phone anyway.
 */

export interface LeakRow {
  kind: string;
  cents: number;
  sentence: string;
  href: string;
  caveat?: string;
}

export function LeakList({
  leaks,
  /** The full ranking, where the same money is grouped by what she would fix
   * rather than by what kind of leak it is. Home shows the period leaks; that
   * screen shows those AND the structural ones — a dormant item, a price
   * standing since April — which have no place in a month's P&L. */
  allHref,
}: {
  leaks: LeakRow[];
  allHref?: string;
}) {
  if (leaks.length === 0) return null;
  const [worst, ...rest] = leaks;

  return (
    <section aria-label="What's hurting it" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="type-label text-muted-foreground">
          The biggest thing hurting it
        </h2>
        <Link
          href={worst.href}
          className="group/leak -mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p className="type-body-lg min-w-0 flex-1">{worst.sentence}</p>
          <ChevronRight
            className="size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Link>
        {worst.caveat && (
          <p className="type-caption text-muted-foreground">{worst.caveat}</p>
        )}
      </div>

      {rest.length > 0 && (
        <ul className="flex flex-col divide-y border-t pt-1">
          {rest.map((leak) => (
            <li key={leak.kind}>
              <Link
                href={leak.href}
                className="flex min-h-11 items-center gap-3 py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="type-body min-w-0 flex-1 text-muted-foreground">
                  {leak.sentence}
                </span>
                <span className="numeric-sm shrink-0 text-muted-foreground">
                  {formatMoneyExact(leak.cents)}
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
              {leak.caveat && (
                <p className="type-caption pb-2 text-muted-foreground">
                  {leak.caveat}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {allHref && (
        <Link
          href={allHref}
          className="-mx-2 flex min-h-11 items-center gap-1 rounded-md px-2 type-label text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Everything worth fixing
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
    </section>
  );
}
