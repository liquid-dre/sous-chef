"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { TOKENS, reasonLabel } from "@/convex/lib/messages";
import { RecipientPanel } from "./recipient-panel";
import type { PreviewData, TemplateRow } from "./types";

/**
 * Writing a message, and seeing what it will actually say.
 *
 * The preview runs against a REAL contact rather than invented placeholders,
 * because the question she is asking is "does this read right for an actual
 * person" and "Hi Jane Doe, your Cake is ready" cannot answer it.
 *
 * It also shows the exclusion count while she is still typing, which is where
 * the token rule earns its place: adding `{item}` to a template silently
 * drops every customer who has never ordered, and finding that out AFTER
 * sending is finding it out from the customers who did not hear from her.
 */

const CHANNELS = [
  { value: "whatsapp" as const, label: "WhatsApp" },
  { value: "email" as const, label: "Email" },
];

export function TemplateEditor({
  draft,
  preview,
  contacts,
  previewContactId,
  onChange,
  onPreviewContact,
  onSave,
  onCancel,
  saving,
}: {
  draft: Pick<TemplateRow, "name" | "channel" | "body" | "subject">;
  /** Null while the first preview is in flight. */
  preview: PreviewData | null;
  contacts: { id: string; name: string }[];
  previewContactId: string | null;
  onChange: (next: Partial<TemplateRow>) => void;
  onPreviewContact: (id: string) => void;
  onSave: () => void;
  onCancel?: () => void;
  saving?: boolean;
}) {
  const canSave = draft.name.trim() !== "" && draft.body.trim() !== "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-name">Name</Label>
        <Input
          id="template-name"
          value={draft.name}
          placeholder="Taking orders"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      {/* Labelled, not just aria-labelled. Every other control on this form
          says what it is above itself, and two unexplained pills between
          "Name" and "Message" read as a segmented view switch rather than as
          a choice that changes what the template can do. */}
      <p className="type-label -mb-1">How does it go out?</p>
      <div
        className="flex min-w-0 gap-1 overflow-x-auto"
        role="group"
        aria-label="Which channel"
      >
        {CHANNELS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={draft.channel === c.value}
            onClick={() => onChange({ channel: c.value })}
            className={cn(
              "min-h-11 shrink-0 rounded-full border px-4 type-label outline-none",
              "transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-out",
              "focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-9",
              draft.channel === c.value
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Subject only for email — WhatsApp has no such thing, and a field
          that silently never renders is worse than one that is not there. */}
      {draft.channel === "email" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-subject">Subject</Label>
          <Input
            id="template-subject"
            value={draft.subject ?? ""}
            placeholder="This week at the kitchen"
            onChange={(e) => onChange({ subject: e.target.value })}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-body">Message</Label>
        <Textarea
          id="template-body"
          value={draft.body}
          rows={4}
          placeholder="Hi {name}, taking orders for {date} — let me know."
          onChange={(e) => onChange({ body: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="type-caption text-muted-foreground">Insert:</span>
          {TOKENS.map((token) => (
            <Button
              key={token}
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 md:min-h-9"
              onClick={() => onChange({ body: `${draft.body}{${token}}` })}
            >
              {`{${token}}`}
            </Button>
          ))}
        </div>
      </div>

      {/* The live preview. Against a real person, with her own data in it. */}
      <section
        aria-label="Preview"
        className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="type-label">As {preview?.previewFor?.name ?? "…"} sees it</h3>
          {contacts.length > 1 && (
            <select
              aria-label="Preview against"
              className="type-caption min-h-11 rounded-md border bg-card px-2 md:min-h-9"
              value={previewContactId ?? preview?.previewFor?.id ?? ""}
              onChange={(e) => onPreviewContact(e.target.value)}
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {preview === null ? (
          <div className="h-12 animate-pulse rounded-md bg-muted" />
        ) : preview.previewText ? (
          <p className="type-body text-pretty">{preview.previewText}</p>
        ) : preview.previewExcluded ? (
          // The preview earns its place most here: it shows her the person
          // this WOULD NOT reach, and says why, before she sends.
          <p className="type-label rounded-md bg-warn-soft p-3 text-warn-foreground">
            {preview.previewFor?.name ?? "This contact"} would not get this —{" "}
            {reasonLabel(preview.previewExcluded)}.
          </p>
        ) : (
          <p className="type-caption text-muted-foreground">
            No contacts yet to preview against.
          </p>
        )}
      </section>

      {preview && <RecipientPanel preview={preview} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-h-11 md:min-h-9"
          disabled={!canSave || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save template"}
        </Button>
        {onCancel && (
          <Button
            variant="ghost"
            className="min-h-11 md:min-h-9"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
