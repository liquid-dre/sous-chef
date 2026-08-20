"use client";

import { cn } from "@/lib/utils";
import type { PreviewData } from "./types";

/**
 * Who is getting it, and who is not, and why.
 *
 * The exclusion list is the point rather than a footnote. "Sending to 34 of
 * 40" with no explanation is a number she cannot act on — and two of the
 * three reasons are things she can fix in a minute: add an email address,
 * reword the template so it stops asking for an item six people have never
 * bought.
 *
 * The one reason she cannot fix is the one with a statute behind it, and it
 * is stated in exactly those terms so it never reads as a bug.
 */
export function RecipientPanel({
  preview,
  className,
}: {
  preview: PreviewData;
  className?: string;
}) {
  const { sendingCount, totalCount, exclusions } = preview;

  return (
    <section
      aria-label="Who this goes to"
      className={cn("flex flex-col gap-2 rounded-lg border bg-card p-4", className)}
    >
      <p className="type-label">
        Sending to <span className="numeric">{sendingCount}</span> of{" "}
        <span className="numeric">{totalCount}</span>
      </p>

      {exclusions.length === 0 ? (
        <p className="type-caption text-muted-foreground">
          {totalCount === 0
            ? "No contacts yet — they arrive with their first order."
            : "Everybody on your list can receive this."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {exclusions.map((group) => (
            <li key={group.label} className="type-caption text-muted-foreground">
              <span className="numeric">{group.names.length}</span> ·{" "}
              {group.label}
              {/* Named while the list is short enough to read. Past four it
                  is a count, because forty names is not information. */}
              {group.names.length <= 4 && <> — {group.names.join(", ")}</>}
            </li>
          ))}
        </ul>
      )}

      {sendingCount === 0 && totalCount > 0 && (
        <p className="type-label rounded-md bg-warn-soft p-3 text-warn-foreground">
          Nobody can receive this as written. Change the wording or check who
          has opted out.
        </p>
      )}
    </section>
  );
}
