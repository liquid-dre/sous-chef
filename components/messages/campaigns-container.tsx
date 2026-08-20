"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Megaphone } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { RouteLoading } from "@/components/route-loading";
import { CampaignForm, type CampaignDraft } from "./campaign-form";
import { CampaignShare } from "./campaign-share";
import type { PreviewData } from "./types";

const BLANK: CampaignDraft = {
  name: "",
  channel: "whatsapp",
  subject: "",
  body: "",
};

export function CampaignsContainer({
  orgSlug,
  emailConfigured,
}: {
  orgSlug: string;
  emailConfigured: boolean;
}) {
  const router = useRouter();
  const [composing, setComposing] = React.useState(false);
  const [draft, setDraft] = React.useState<CampaignDraft>(BLANK);
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const history = useQuery(api.messages.campaignHistory, { orgSlug });
  const preview = useQuery(
    api.messages.preview,
    composing
      ? { orgSlug, body: draft.body, channel: draft.channel }
      : "skip",
  );

  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const createCampaign = useMutation(api.messages.createCampaign);
  const replaceToken = useMutation(api.messages.replaceCampaignToken);

  if (history === undefined) return <RouteLoading />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/${orgSlug}/messages`}
          className="type-caption inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          Messages
        </Link>
        <h1 className="type-display mt-1">Campaigns</h1>
        <p className="type-body text-muted-foreground">
          One flyer, everybody who wants to hear from you.
        </p>
      </div>

      {composing ? (
        <CampaignForm
          draft={draft}
          preview={(preview as PreviewData | undefined) ?? null}
          file={file}
          uploading={uploading}
          saving={saving}
          error={error}
          emailConfigured={emailConfigured}
          onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
          onFile={setFile}
          onCancel={() => {
            setComposing(false);
            setDraft(BLANK);
            setFile(null);
            setError(null);
          }}
          onCreate={async () => {
            setError(null);
            let fileId: Id<"_storage"> | undefined;
            // Upload first, and only then create. The other order would leave
            // a campaign in her history pointing at a file that never arrived,
            // which reads as a bug in Sous rather than as a failed upload.
            if (file) {
              setUploading(true);
              try {
                const uploadUrl = await generateUploadUrl({
                  orgSlug,
                  contentType: file.type,
                  sizeBytes: file.size,
                });
                const result = await fetch(uploadUrl, {
                  method: "POST",
                  headers: { "Content-Type": file.type },
                  body: file,
                });
                if (!result.ok) throw new Error("Upload failed");
                const uploaded = (await result.json()) as {
                  storageId: Id<"_storage">;
                };
                fileId = uploaded.storageId;
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Couldn't upload that PDF. Nothing was queued.",
                );
                setUploading(false);
                return;
              } finally {
                setUploading(false);
              }
            }

            setSaving(true);
            try {
              await createCampaign({
                orgSlug,
                name: draft.name,
                channel: draft.channel,
                body: draft.body,
                ...(draft.channel === "email" && draft.subject.trim()
                  ? { subject: draft.subject }
                  : {}),
                ...(fileId ? { fileId } : {}),
              });
              setComposing(false);
              setDraft(BLANK);
              setFile(null);
              // Straight to the outbox: the drafts are what she does next.
              router.push(`/${orgSlug}/messages`);
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Couldn't queue that. Nothing was sent.",
              );
              setSaving(false);
            }
          }}
        />
      ) : history.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          body="Upload the month's menu once and it goes to everyone who wants it — attached to an email, or as a link you post to your story."
          actionLabel="New campaign"
          onAction={() => {
            setDraft(BLANK);
            setComposing(true);
          }}
        />
      ) : (
        <>
          <div>
            <Button
              className="min-h-11 md:min-h-9"
              onClick={() => {
                setDraft(BLANK);
                setComposing(true);
              }}
            >
              New campaign
            </Button>
          </div>

          <ul className="flex flex-col gap-2">
            {history.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="type-label">{c.name}</span>
                  <span className="type-caption text-muted-foreground">
                    {c.channel === "whatsapp" ? "WhatsApp" : "Email"}
                  </span>
                </div>
                {/* What actually happened, not what was intended. Sent and
                    skipped are her answers in the queue; the difference
                    between them and the recipient count is what is still
                    waiting. */}
                <p className="type-caption text-muted-foreground">
                  <span className="numeric">{c.sent}</span> sent
                  {c.skipped > 0 && (
                    <>
                      {" · "}
                      <span className="numeric">{c.skipped}</span> skipped
                    </>
                  )}
                  {" · "}
                  <span className="numeric">{c.recipients}</span> on the list
                </p>

                {c.hasFile && <CampaignShare token={c.token} name={c.name} />}

                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 md:min-h-9"
                    onClick={async () => {
                      await replaceToken({
                        orgSlug,
                        campaignId: c.id as Id<"campaigns">,
                      });
                    }}
                  >
                    Replace the link
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="type-caption text-muted-foreground">
            Replacing a link stops the old one working. The campaign and who it
            went to are kept.
          </p>
        </>
      )}
    </div>
  );
}
