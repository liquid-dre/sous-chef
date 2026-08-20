"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, FileText } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { RouteLoading } from "@/components/route-loading";
import { useClientToday } from "@/components/use-client-today";
import { WEEKDAY_LABEL } from "@/convex/lib/messages";
import { TemplateEditor } from "./template-editor";
import { RemoveTemplateDialog } from "./remove-template-dialog";
import type { PreviewData, TemplateRow } from "./types";

type Draft = Pick<TemplateRow, "name" | "channel" | "body" | "subject">;

const BLANK: Draft = { name: "", channel: "whatsapp", body: "", subject: null };

export function TemplatesContainer({ orgSlug }: { orgSlug: string }) {
  const today = useClientToday();
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [draft, setDraft] = React.useState<Draft>(BLANK);
  const [previewContactId, setPreviewContactId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const templates = useQuery(api.messages.templates, { orgSlug });
  const schedules = useQuery(
    api.messages.schedules,
    today ? { orgSlug, today } : "skip",
  );
  const preview = useQuery(
    api.messages.preview,
    editing
      ? {
          orgSlug,
          body: draft.body,
          channel: draft.channel,
          ...(previewContactId
            ? { customerId: previewContactId as Id<"customers"> }
            : {}),
        }
      : "skip",
  );

  const saveTemplate = useMutation(api.messages.saveTemplate);
  const removeTemplate = useMutation(api.messages.removeTemplate);
  const saveSchedule = useMutation(api.messages.saveSchedule);
  const removeSchedule = useMutation(api.messages.removeSchedule);

  if (templates === undefined) return <RouteLoading />;

  const scheduleFor = (templateId: string) =>
    (schedules ?? []).find((s) => s.templateId === templateId) ?? null;

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
        <h1 className="type-display mt-1">Templates</h1>
        <p className="type-body text-muted-foreground">
          The words you send often, with the bits that change filled in per
          person.
        </p>
      </div>

      {editing ? (
        <TemplateEditor
          draft={draft}
          preview={(preview as PreviewData | undefined) ?? null}
          contacts={preview?.contacts ?? []}
          previewContactId={previewContactId}
          saving={saving}
          onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
          onPreviewContact={setPreviewContactId}
          onCancel={() => {
            setEditing(null);
            setDraft(BLANK);
          }}
          onSave={async () => {
            setSaving(true);
            try {
              await saveTemplate({
                orgSlug,
                ...(editing !== "new"
                  ? { templateId: editing as Id<"messageTemplates"> }
                  : {}),
                name: draft.name,
                channel: draft.channel,
                body: draft.body,
                ...(draft.subject ? { subject: draft.subject } : {}),
              });
              setEditing(null);
              setDraft(BLANK);
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          body="Write the message you send most weeks once, and Sous fills in each person's name and what they last ordered."
          actionLabel="Write one"
          onAction={() => {
            setDraft(BLANK);
            setEditing("new");
          }}
        />
      ) : (
        <>
          <div>
            <Button
              className="min-h-11 md:min-h-9"
              onClick={() => {
                setDraft(BLANK);
                setEditing("new");
              }}
            >
              New template
            </Button>
          </div>

          <ul className="flex flex-col gap-2">
            {templates.map((t) => {
              const schedule = scheduleFor(t.id);
              return (
                <li
                  key={t.id}
                  className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="type-label">{t.name}</span>
                    <span className="type-caption text-muted-foreground">
                      {t.channel === "whatsapp" ? "WhatsApp" : "Email"}
                    </span>
                  </div>
                  <p className="type-caption text-pretty text-muted-foreground">
                    {t.body}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 md:min-h-9"
                      onClick={() => {
                        setDraft({
                          name: t.name,
                          channel: t.channel,
                          body: t.body,
                          subject: t.subject,
                        });
                        setEditing(t.id);
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" className="min-h-11 md:min-h-9" asChild>
                      <Link href={`/${orgSlug}/messages/send?template=${t.id}`}>
                        Send now
                      </Link>
                    </Button>
                    <RemoveTemplateDialog
                      name={t.name}
                      hasSchedule={schedule !== null}
                      onRemove={async () => {
                        await removeTemplate({
                          orgSlug,
                          templateId: t.id as Id<"messageTemplates">,
                        });
                      }}
                    />
                  </div>

                  {/* The recurring rule lives with the words it sends. A
                      separate schedules screen would mean holding two things
                      in her head to answer "what goes out on Sunday". */}
                  <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                    <span className="type-caption text-muted-foreground">
                      Every week on
                    </span>
                    <select
                      aria-label={`Weekly day for ${t.name}`}
                      className="type-caption min-h-11 rounded-md border bg-card px-2 md:min-h-9"
                      value={schedule ? String(schedule.weekday) : ""}
                      onChange={async (e) => {
                        const value = e.target.value;
                        if (value === "") {
                          if (schedule) {
                            await removeSchedule({
                              orgSlug,
                              scheduleId: schedule.id as Id<"messageSchedules">,
                            });
                          }
                          return;
                        }
                        await saveSchedule({
                          orgSlug,
                          ...(schedule
                            ? { scheduleId: schedule.id as Id<"messageSchedules"> }
                            : {}),
                          templateId: t.id as Id<"messageTemplates">,
                          weekday: Number(value),
                        });
                      }}
                    >
                      <option value="">never</option>
                      {WEEKDAY_LABEL.map((label, i) => (
                        <option key={label} value={i}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {schedule?.dueToday && (
                      <span className="type-caption rounded-full bg-primary-soft px-2 py-0.5 text-primary">
                        due today
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
