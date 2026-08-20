import "server-only";
import { Resend } from "resend";
import type { ComposedEmail } from "./invoice-email";

/**
 * The one place Sous talks to Resend.
 *
 * Wrapped rather than called inline so the route stays readable and so a
 * failure comes back as a sentence she can act on rather than a provider
 * error object. Nothing here throws: an email that did not send is a normal
 * outcome, not an exception.
 */

/**
 * The From address, or null when email has not been set up.
 *
 * Null is the honest state for a kitchen that has not connected a domain yet,
 * and every caller treats it as "hide the action" rather than "fail on tap".
 */
export function mailFrom(): string | null {
  const from = process.env.SOUS_MAIL_FROM;
  const key = process.env.RESEND_API_KEY;
  return from && key ? from : null;
}

/**
 * One email, with an attachment only if there is one.
 *
 * `sendInvoiceEmail` below cannot be reused for this: it REQUIRES a
 * `Uint8Array` PDF and always attaches it, because an invoice without its
 * document is not an invoice. The alert digest has nothing to attach — one
 * short sentence per alert — and a campaign has a flyer she uploaded. So the
 * attachment is OPTIONAL here and mandatory there, which is the honest
 * difference between the two.
 *
 * Same contract as everything else in this file: nothing throws, and a
 * failure comes back as a sentence she can act on.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  from: string;
  replyTo: string | null;
  /** Omit for a plain message. An empty array is treated as none rather than
   * handed to Resend, which rejects it. */
  attachments?: { filename: string; content: Uint8Array }[];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, message: "Email isn't set up for this kitchen yet." };
  }
  try {
    const { error } = await new Resend(key).emails.send({
      from: args.from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      ...(args.attachments && args.attachments.length > 0
        ? {
            attachments: args.attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content),
            })),
          }
        : {}),
    });
    if (error) {
      return {
        ok: false,
        message: `Couldn't send it: ${error.message}. Nothing was sent.`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach the email service. Nothing was sent.",
    };
  }
}

export async function sendInvoiceEmail(args: {
  composed: ComposedEmail;
  pdf: Uint8Array;
  from: string;
  replyTo: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, message: "Email isn't set up for this kitchen yet." };
  }

  try {
    const { error } = await new Resend(key).emails.send({
      from: args.from,
      to: args.composed.to,
      subject: args.composed.subject,
      text: args.composed.text,
      html: args.composed.html,
      // Without this a reply goes to a Sous domain nobody reads. The whole
      // point of sending from Sous is deliverability; the whole point of
      // reply-to is that the customer still reaches HER.
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      attachments: [
        {
          filename: args.composed.attachmentFilename,
          content: Buffer.from(args.pdf),
        },
      ],
    });
    if (error) {
      return {
        ok: false,
        message: `Couldn't send it: ${error.message}. Nothing was sent.`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach the email service. Nothing was sent.",
    };
  }
}
