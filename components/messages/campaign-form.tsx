"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_CAMPAIGN_BYTES } from "@/convex/lib/messages";
import { RecipientPanel } from "./recipient-panel";
import type { PreviewData } from "./types";

export interface CampaignDraft {
  name: string;
  channel: "whatsapp" | "email";
  subject: string;
  body: string;
}

/**
 * One campaign: the flyer, the words, and who gets it.
 *
 * The two channels are genuinely different things and the form says so rather
 * than pretending otherwise. Email carries the PDF as an attachment. WhatsApp
 * cannot — a story is a link — so the same PDF becomes a page at /c/[token]
 * with her letterhead round it, and she posts that. Hiding the difference
 * behind one "Send" button is how a flyer arrives as a broken attachment.
 *
 * The PDF is optional. A campaign that is only words is a perfectly good
 * campaign, and requiring an upload would mean opening Canva to say "we are
 * closed on Monday".
 *
 * Nothing sends from here either. Creating a campaign writes the same outbox
 * rows a batch does, and she works them through the queue.
 */
export function CampaignForm({
  draft,
  preview,
  file,
  uploading,
  saving,
  error,
  emailConfigured,
  onChange,
  onFile,
  onCancel,
  onCreate,
}: {
  draft: CampaignDraft;
  preview: PreviewData | null;
  file: File | null;
  uploading: boolean;
  saving: boolean;
  error: string | null;
  emailConfigured: boolean;
  onChange: (next: Partial<CampaignDraft>) => void;
  onFile: (file: File | null) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);

  const ready =
    draft.name.trim() !== "" &&
    draft.body.trim() !== "" &&
    (preview?.sendingCount ?? 0) > 0 &&
    !uploading &&
    !saving;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="campaign-name">What is this one?</Label>
        <Input
          id="campaign-name"
          value={draft.name}
          placeholder="August menu"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <p className="type-caption text-muted-foreground">
          For you and for the download&rsquo;s filename. Your customers see it
          at the top of the page.
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="type-label pb-1.5">How does it go out?</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["whatsapp", "WhatsApp"],
              ["email", "Email"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={draft.channel === value ? "default" : "outline"}
              className="min-h-11 md:min-h-9"
              aria-pressed={draft.channel === value}
              onClick={() => onChange({ channel: value })}
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="type-caption text-muted-foreground">
          {draft.channel === "whatsapp"
            ? "You get a link to post to your story, and one chat per person to send from your own number."
            : emailConfigured
              ? "The PDF attaches to the email."
              : "Email isn't set up for this kitchen yet — connect a domain in Settings, or send this on WhatsApp."}
        </p>
      </fieldset>

      {draft.channel === "email" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-subject">Subject line</Label>
          <Input
            id="campaign-subject"
            value={draft.subject}
            placeholder="This month's menu"
            onChange={(e) => onChange({ subject: e.target.value })}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="campaign-body">What does it say?</Label>
        <Textarea
          id="campaign-body"
          value={draft.body}
          rows={4}
          placeholder="Hi {name}, the August menu is out. Orders close Thursday."
          onChange={(e) => onChange({ body: e.target.value })}
        />
        <p className="type-caption text-muted-foreground">
          {"{name}"}, {"{item}"} and {"{balance}"} fill in per person. Anyone
          they cannot be filled in for is listed below rather than sent half a
          sentence.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="campaign-file">The flyer (optional)</Label>
        {/* The three-step upload this repo already uses for the logo: pick,
            PUT to a one-time URL, record the id. The hidden input keeps the
            button a Button rather than a browser-styled file control. */}
        <input
          ref={fileInput}
          id="campaign-file"
          type="file"
          accept="application/pdf"
          className="sr-only"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setFileError(null);
            if (!picked) {
              onFile(null);
              return;
            }
            if (picked.type !== "application/pdf") {
              setFileError("That needs to be a PDF.");
              onFile(null);
              return;
            }
            if (picked.size > MAX_CAMPAIGN_BYTES) {
              // Checked here so she finds out before the upload rather than
              // after it. The mutation checks again, because the UI is not a
              // boundary.
              setFileError(
                `That PDF is ${Math.round(picked.size / 1024 / 1024)}MB. Keep it under ${MAX_CAMPAIGN_BYTES / 1024 / 1024}MB so it actually arrives.`,
              );
              onFile(null);
              return;
            }
            onFile(picked);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 md:min-h-9"
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip aria-hidden />
            {file ? "Choose another" : "Choose a PDF"}
          </Button>
          {file && (
            <span className="type-caption min-w-0 truncate text-muted-foreground">
              {file.name}
            </span>
          )}
        </div>
        {fileError && (
          <p className="type-caption text-loss-foreground" role="alert">
            {fileError}
          </p>
        )}
      </div>

      {preview && <RecipientPanel preview={preview} />}

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
          disabled={!ready}
          onClick={onCreate}
        >
          {uploading
            ? "Uploading…"
            : saving
              ? "Preparing…"
              : `Queue ${preview?.sendingCount ?? 0} ${preview?.sendingCount === 1 ? "message" : "messages"}`}
        </Button>
        <Button
          variant="ghost"
          className="min-h-11 md:min-h-9"
          disabled={uploading || saving}
          onClick={onCancel}
        >
          Not now
        </Button>
      </div>
      <p className="type-caption text-muted-foreground">
        Nothing sends yet. This puts one draft per person in your outbox.
      </p>
    </div>
  );
}
