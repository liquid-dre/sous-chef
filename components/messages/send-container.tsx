"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RouteLoading } from "@/components/route-loading";
import { reasonLabel } from "@/convex/lib/messages";
import { RecipientPanel } from "./recipient-panel";
import type { PreviewData } from "./types";

/**
 * Reviewing who a message goes to, before any of it goes.
 *
 * Its own screen rather than a card, because she is about to write to forty
 * people and "who is excluded and why" is the thing the scope asks to be
 * shown — squeezed into a drawer it becomes a number she scrolls past.
 *
 * She can CUT the list here and never add to it: the checkboxes narrow
 * `onlyCustomerIds`, and the server still runs every recipient through the
 * consent gate afterwards. Ticking somebody who opted out changes nothing,
 * which is the correct outcome and is asserted in convex/messages.test.ts.
 */
export function SendContainer({
  orgSlug,
  templateId,
  scheduleKey,
}: {
  orgSlug: string;
  templateId: string | null;
  scheduleKey: string | null;
}) {
  const router = useRouter();
  const [messageDate, setMessageDate] = React.useState("");
  const [dropped, setDropped] = React.useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const templates = useQuery(api.messages.templates, { orgSlug });
  const template = templates?.find((t) => t.id === templateId) ?? null;

  const preview = useQuery(
    api.messages.preview,
    template
      ? {
          orgSlug,
          body: template.body,
          channel: template.channel,
          messageDate: messageDate || undefined,
        }
      : "skip",
  );
  const startBatch = useMutation(api.messages.startBatch);

  if (templates === undefined) return <RouteLoading />;
  if (!template) {
    return (
      <div className="flex flex-col gap-3">
        <p className="type-body text-muted-foreground">
          That template is gone. Pick another one.
        </p>
        <div>
          <Button variant="outline" asChild>
            <Link href={`/${orgSlug}/messages/templates`}>Templates</Link>
          </Button>
        </div>
      </div>
    );
  }

  // `{date}` is the one token she types — a Wednesday is a fact about the
  // message, not about the person reading it.
  const needsDate = template.tokens.includes("date");
  const dateMissing = needsDate && messageDate.trim() === "";

  const sendable = (preview?.sendingCount ?? 0) > 0 && !dateMissing;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href={`/${orgSlug}/messages`}
          className="type-caption inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          Messages
        </Link>
        <h1 className="type-display mt-1">{template.name}</h1>
        <p className="type-body text-muted-foreground">
          Review who this goes to. Nothing sends until you work through the
          queue.
        </p>
      </div>

      {needsDate && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="message-date">What does {"{date}"} say?</Label>
          <Input
            id="message-date"
            value={messageDate}
            placeholder="Wednesday"
            onChange={(e) => setMessageDate(e.target.value)}
          />
          <p className="type-caption text-muted-foreground">
            The same words for everyone — it is about the message, not the
            person.
          </p>
        </div>
      )}

      {preview === undefined ? (
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      ) : (
        <>
          <section
            aria-label="Preview"
            className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4"
          >
            <h2 className="type-label">
              As {preview.previewFor?.name ?? "a customer"} sees it
            </h2>
            {preview.previewText ? (
              <p className="type-body text-pretty">{preview.previewText}</p>
            ) : preview.previewExcluded ? (
              <p className="type-label rounded-md bg-warn-soft p-3 text-warn-foreground">
                {preview.previewFor?.name ?? "This contact"} would not get this
                — {reasonLabel(preview.previewExcluded)}.
              </p>
            ) : (
              <p className="type-caption text-muted-foreground">
                {dateMissing
                  ? "Fill in the date above to see it."
                  : "No contacts yet to preview against."}
              </p>
            )}
          </section>

          <RecipientPanel preview={preview as PreviewData} />

          {/* Cutting the list. She can take people OUT; consent decides who
              was ever in. */}
          {preview.contacts.length > 0 && (
            <section
              aria-label="Choose recipients"
              className="flex flex-col gap-2 rounded-lg border bg-card p-4"
            >
              <h2 className="type-title">Everyone on the list</h2>
              <p className="type-caption text-muted-foreground">
                Untick anyone you would rather skip this time.
              </p>
              <ul className="flex flex-col divide-y">
                {preview.contacts.map((c) => (
                  <li key={c.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
                      {/* The design system's control, not a raw input: it
                          carries the focus ring and the hit-area expansion a
                          bare checkbox has none of. */}
                      <Checkbox
                        checked={!dropped.has(c.id)}
                        onCheckedChange={(checked) =>
                          setDropped((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(c.id);
                            else next.add(c.id);
                            return next;
                          })
                        }
                      />
                      <span className="type-body min-w-0 flex-1 truncate">
                        {c.name}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {error && (
        <p
          className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-h-11 md:min-h-9"
          disabled={!sendable || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const chosen = (preview?.contacts ?? [])
                .filter((c) => !dropped.has(c.id))
                .map((c) => c.id as Id<"customers">);
              await startBatch({
                orgSlug,
                body: template.body,
                channel: template.channel,
                templateId: template.id as Id<"messageTemplates">,
                ...(scheduleKey ? { scheduleKey } : {}),
                ...(messageDate ? { messageDate } : {}),
                onlyCustomerIds: chosen,
              });
              router.push(`/${orgSlug}/messages`);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Couldn't start it — try again.",
              );
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Preparing…"
            : `Queue ${preview?.sendingCount ?? 0} ${preview?.sendingCount === 1 ? "message" : "messages"}`}
        </Button>
        {dateMissing && (
          <span className="type-caption text-muted-foreground">
            Fill in the date first.
          </span>
        )}
      </div>
    </div>
  );
}
