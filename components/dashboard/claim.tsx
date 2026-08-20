import { cn } from "@/lib/utils";
import { formatMoneyExact } from "@/components/charts-sous/format";

/**
 * The sentence she opens Sous to read.
 *
 * Typography, not a card. A grid of stat cards makes five numbers equally
 * important and therefore makes none of them the answer; this is one claim,
 * read left to right, with the profit figure carrying the weight because that
 * is the question. Everything below it on the screen is evidence for this.
 *
 * Money in the numeric face, always; negative money red AND parenthesised,
 * because colour alone fails a colourblind reader and fails again in a
 * WhatsApp screenshot — which is how she will show it to her husband.
 */

export interface ClaimData {
  periodLabel: string;
  grossRevenueCents: number;
  totalCostCents: number;
  profitCents: number;
  netMarginPercent: number | null;
  targetNetMarginPercent: number | null;
  uncostedRevenueCents: number;
  uncostedSharePercent: number;
  previousPeriodMarginPercent: number | null;
  rollingFourWeekMarginPercent: number | null;
  orderCount: number;
}

function Figure({
  label,
  cents,
  tone,
}: {
  label: string;
  cents: number;
  tone?: "profit" | "loss";
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={cn(
          "numeric-xl",
          tone === "profit" && "text-profit-foreground",
          tone === "loss" && "text-loss-foreground",
        )}
      >
        {formatMoneyExact(cents)}
      </span>
      <span className="type-body text-muted-foreground">{label}</span>
    </span>
  );
}

export function Claim({ data }: { data: ClaimData }) {
  const {
    profitCents,
    netMarginPercent: margin,
    targetNetMarginPercent: target,
  } = data;
  const losing = profitCents < 0;

  return (
    <section aria-label="This period" className="flex flex-col gap-3">
      <p className="type-label text-muted-foreground">{data.periodLabel}</p>

      {/* One sentence, wrapping naturally. Readable across a kitchen. */}
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <Figure label="in" cents={data.grossRevenueCents} />
        <Figure label="out" cents={data.totalCostCents} />
        <Figure
          label={losing ? "lost" : "profit"}
          cents={profitCents}
          tone={losing ? "loss" : "profit"}
        />
        {margin != null && (
          <span
            className={cn(
              "numeric-xl",
              losing ? "text-loss-foreground" : "text-profit-foreground",
            )}
          >
            {margin}%
          </span>
        )}
      </p>

      <p className="type-body-lg text-muted-foreground">
        {margin == null ? (
          // Not "0%". A kitchen with nothing delivered does not have a zero
          // margin; it has no margin, and saying 0% would be a number Sous
          // cannot stand behind.
          <>Nothing delivered in this period yet.</>
        ) : (
          <>
            {target != null ? (
              <>
                Your target is{" "}
                <span className="numeric">{target}%</span>.{" "}
                {margin >= target ? (
                  <span className="text-profit-foreground">You&rsquo;re above it.</span>
                ) : (
                  <>
                    You&rsquo;re{" "}
                    <span className="numeric">{target - margin}</span> points
                    under.
                  </>
                )}{" "}
              </>
            ) : null}
            <Comparison
              previous={data.previousPeriodMarginPercent}
              rolling={data.rollingFourWeekMarginPercent}
            />
          </>
        )}
      </p>

      {/* Said plainly, never folded in: revenue whose cost is unknown cannot
          produce a margin, so it is not in any figure above. */}
      {data.uncostedRevenueCents > 0 && (
        <p className="type-caption text-muted-foreground">
          Plus{" "}
          <span className="numeric">
            {formatMoneyExact(data.uncostedRevenueCents)}
          </span>{" "}
          of off-menu work —{" "}
          <span className="numeric">{data.uncostedSharePercent}%</span>
          {" of what you took. Sous can’t cost it, so it isn’t in those figures."}
        </p>
      )}
    </section>
  );
}

/** Her own past, which is a fact where a target is an aspiration. */
function Comparison({
  previous,
  rolling,
}: {
  previous: number | null;
  rolling: number | null;
}) {
  const parts: string[] = [];
  if (previous != null) parts.push(`${previous}% last time`);
  if (rolling != null) parts.push(`${rolling}% over four weeks`);
  if (parts.length === 0) return null;
  return (
    <>
      <span className="numeric">{parts.join(" · ")}</span>.
    </>
  );
}
