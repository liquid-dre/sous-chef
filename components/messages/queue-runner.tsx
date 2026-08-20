"use client";

import * as React from "react";
import { Check, Send, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { waLink } from "@/lib/whatsapp";
import type { QueueRow } from "./types";

/**
 * Send · mark done · next. Twenty times, without losing her place.
 *
 * THE WHOLE POINT IS RESUMPTION. She is standing in a kitchen sending twenty
 * messages by hand; the phone rings, the oven goes, the tab reloads. The
 * queue is a server query over one row per recipient, so "which twelve are
 * done" survives a reload, a crash, and picking the phone up after starting
 * on the laptop. Nothing here holds progress in component state.
 *
 * SHE CONFIRMS, because the browser cannot see whether she pressed send in
 * WhatsApp. Tapping through marks the row OPENED and it stays in the list
 * with two answers waiting; that costs a tap per message and buys the only
 * version where "sent" in the database means she sent it. The alternative —
 * counting an opened link as a send — records messages that never went and
 * she finds out when nobody replies.
 *
 * EMAIL IS THE OTHER SHAPE. There the server does the sending, so there is
 * nothing to confirm — one tap, and the row is sent or it is not. Only
 * WhatsApp needs the Sent/Skip question, because only WhatsApp happens in an
 * app this code cannot see into.
 *
 * Per-row in-flight state, not one global flag: with twenty rows a single
 * `busy` boolean would grey out the whole list every time she answered one.
 */

function progressLabel(done: number, total: number): string {
  if (total === 0) return "Nothing waiting";
  if (done === 0) return `${total} to send`;
  return `${done} of ${done + total} done`;
}

export function QueueRunner({
  rows,
  doneToday,
  onOpen,
  onSent,
  onSkip,
  onSendEmail,
  emailConfigured,
  errors,
  inFlight,
}: {
  rows: QueueRow[];
  doneToday: number;
  /** Fired as WhatsApp opens — moves the row to "waiting on her answer". */
  onOpen: (row: QueueRow) => void;
  onSent: (row: QueueRow) => void;
  onSkip: (row: QueueRow) => void;
  /** Email only: the server sends and marks. Nothing to confirm. */
  onSendEmail: (row: QueueRow) => void;
  /** No Resend key or no verified domain — SETUP.md. The action is hidden
   * rather than failing on tap. */
  emailConfigured: boolean;
  /** Row id → the sentence that came back. Per row, because one bounced
   * address must not read as twenty failures. */
  errors: ReadonlyMap<string, string>;
  /** Row ids with a mutation in flight. A Set rather than a boolean so one
   * answer does not freeze the other nineteen. */
  inFlight: ReadonlySet<string>;
}) {
  // The one she is on: the first row already opened, else the first row at
  // all. Derived from the server data rather than held here, which is what
  // makes a reload land in the same place.
  const current = rows.find((r) => r.opened) ?? rows[0] ?? null;

  return (
    <section aria-label="Messages to send" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-title">Ready to send</h2>
        <p className="type-caption text-muted-foreground">
          <span className="numeric">{progressLabel(doneToday, rows.length)}</span>
        </p>
      </div>

      {/* A plain rule rather than a component: there is no Progress in the
          design system, and one bar does not justify inventing one. */}
      {doneToday + rows.length > 0 && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={doneToday + rows.length}
          aria-valuenow={doneToday}
          aria-label="Messages sent"
        >
          <div
            className="h-full bg-primary"
            style={{ width: `${(doneToday / (doneToday + rows.length)) * 100}%` }}
          />
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const isCurrent = current?.id === row.id;
          const busy = inFlight.has(row.id);
          const href = waLink(row.phone, row.body);
          const failed = errors.get(row.id) ?? null;

          return (
            <li
              key={row.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border px-3 py-2.5",
                isCurrent ? "border-primary bg-card" : "bg-card",
                // Rows below the current one recede. Not hidden — she can see
                // how many are left, which is the anxiety the progress line
                // exists to answer.
                !isCurrent && "opacity-70",
              )}
            >
              <div className="flex flex-col gap-0.5">
                <p className="type-label">{row.customerName}</p>
                <p className="type-caption text-pretty text-muted-foreground">
                  {row.body}
                </p>
              </div>

              {failed && (
                <p
                  className="type-caption rounded-md bg-loss-soft p-2 text-loss-foreground"
                  role="alert"
                >
                  {failed}
                </p>
              )}

              {row.channel === "email" ? (
                // Sous does the sending here, so there is no "did it send?"
                // to ask — the row moves when the provider accepted it and
                // not before.
                !emailConfigured ? (
                  <p className="type-caption text-muted-foreground">
                    Email isn&rsquo;t set up for this kitchen yet. Skip this
                    one, or send it from your own inbox.
                  </p>
                ) : row.email ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={isCurrent ? "default" : "outline"}
                      size="sm"
                      className="min-h-11 md:min-h-9"
                      disabled={busy}
                      onClick={() => onSendEmail(row)}
                    >
                      <Send aria-hidden />
                      {busy ? "Sending…" : `Email ${row.customerName.split(" ")[0]}`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 md:min-h-9"
                      disabled={busy}
                      onClick={() => onSkip(row)}
                    >
                      <SkipForward aria-hidden />
                      Skip
                    </Button>
                  </div>
                ) : (
                  <p className="type-caption text-muted-foreground">
                    No email address on file — skip this one, or add an address
                    on their contact.
                  </p>
                )
              ) : row.opened ? (
                // She has been to WhatsApp. The only question left is whether
                // it actually went.
                <div className="flex flex-wrap items-center gap-2">
                  <span className="type-caption text-muted-foreground">
                    Did it send?
                  </span>
                  <Button
                    size="sm"
                    className="min-h-11 md:min-h-9"
                    disabled={busy}
                    onClick={() => onSent(row)}
                  >
                    <Check aria-hidden />
                    Sent
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 md:min-h-9"
                    disabled={busy}
                    onClick={() => onSkip(row)}
                  >
                    <SkipForward aria-hidden />
                    Skip
                  </Button>
                </div>
              ) : href ? (
                <div>
                  <Button
                    variant={isCurrent ? "default" : "outline"}
                    size="sm"
                    className="min-h-11 md:min-h-9"
                    disabled={busy}
                    asChild
                  >
                    {/* A real link, not a router push: WhatsApp is another
                        app, and the OS needs a genuine navigation. */}
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => onOpen(row)}
                    >
                      Open WhatsApp
                    </a>
                  </Button>
                </div>
              ) : (
                <p className="type-caption text-muted-foreground">
                  No number on file — skip this one or add a number on their
                  contact.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
