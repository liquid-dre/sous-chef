import type { Reminder } from "@/convex/lib/contacts";
import type { ExclusionReason, Token } from "@/convex/lib/messages";

/**
 * The messages screen's view model, free of Convex so the specimen can mount
 * every state — including the one that matters most, a queue stopped
 * half-way.
 */

export interface QueueRow {
  id: string;
  campaignId: string | null;
  channel: "whatsapp" | "email";
  body: string;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  email: string | null;
  /** She tapped through and has not answered yet. A reload has to come back
   * to this, not reset it. */
  opened: boolean;
  openedAt: number | null;
}

export interface DueDraft {
  scheduleId: string;
  key: string;
  templateId: string;
  templateName: string;
  channel: "whatsapp" | "email";
  body: string;
  subject: string | null;
}

export interface OutboxData {
  today: string;
  queue: QueueRow[];
  dueDrafts: DueDraft[];
  reminders: Reminder[];
  doneToday: number;
}

export interface TemplateRow {
  id: string;
  name: string;
  channel: "whatsapp" | "email";
  body: string;
  subject: string | null;
  tokens: Token[];
}

export interface ScheduleRow {
  id: string;
  templateId: string;
  templateName: string;
  weekday: number;
  active: boolean;
  dueToday: boolean;
}

export interface PreviewData {
  tokens: Token[];
  contacts: { id: string; name: string }[];
  previewFor: { id: string; name: string } | null;
  previewText: string | null;
  previewExcluded: ExclusionReason | null;
  sendingCount: number;
  totalCount: number;
  exclusions: { label: string; names: string[] }[];
}

export type { Reminder, Token };
