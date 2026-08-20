import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { resolveOrgAccess } from "@/lib/auth/org";
import { mailFrom, sendEmail } from "@/lib/mailer";
import { MAX_CAMPAIGN_BYTES } from "@/convex/lib/messages";

/**
 * Send ONE outbox row by email.
 *
 * One row per request, not a batch. Twenty in a loop inside a single handler
 * means a timeout half-way leaves her with no idea which nine went, and the
 * whole point of the outbox is that the answer to "which ones are done" is a
 * fact in the database rather than something she reconstructs. Per row, a
 * failure marks exactly that row and the other nineteen are untouched.
 *
 * It lives in Next rather than Convex because `convex/lib/functions.ts`
 * exposes no action wrapper — eight builders, none of them able to make a
 * network call — and Resend is a network call. Tenancy still ends in Convex:
 * this reads and writes through owner-scoped functions using the CALLER'S OWN
 * JWT, so it reaches exactly what she reaches.
 *
 * The recipient comes from `sendPayload`, never from the request body. A
 * route that accepted `to:` from the browser would be a spam relay wearing
 * her domain's reputation, and that reputation is the only thing keeping her
 * mail out of junk folders.
 *
 * WhatsApp never comes through here. That is a wa.me link she taps, with no
 * server in the path — no Business API, no per-message cost, and her customer
 * replies to a real person.
 */

export const runtime = "nodejs";
// A file fetch plus Resend. Well under the invoice route's budget, which also
// runs Chromium.
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: { orgSlug?: string; outboxId?: string };
  try {
    body = await request.json();
  } catch {
    return problem(400, "That request didn't make sense.");
  }
  const { orgSlug, outboxId } = body;
  if (!orgSlug || !outboxId) return problem(400, "That request didn't make sense.");

  // The same silence every other route gives a non-member.
  const access = await resolveOrgAccess(orgSlug);
  if (!access) return problem(404, "Not found.");

  const from = mailFrom();
  if (!from) {
    return problem(
      503,
      "Email isn't set up for this kitchen yet. Send this one on WhatsApp instead.",
    );
  }

  const { getToken } = await auth();
  const jwt =
    (await getToken({ template: "convex" }).catch(() => null)) ??
    (await getToken());
  if (!jwt) return problem(401, "Sign in again.");

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return problem(503, "This kitchen isn't connected yet.");
  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(jwt);

  let payload;
  try {
    payload = await convex.query(api.messages.sendPayload, {
      orgSlug,
      outboxId: outboxId as Id<"outbox">,
    });
  } catch {
    // NOT_FOUND covers another kitchen's row, a deleted one, and a WhatsApp
    // row sent here by mistake. None of them is something the caller should
    // be able to tell apart from outside.
    return problem(404, "Not found.");
  }

  if (payload.alreadySent) {
    // Idempotent, like `markSent`. A double tap or a retry after a flaky
    // connection must not put a second copy in somebody's inbox.
    return Response.json({ ok: true, to: payload.to, resent: false });
  }
  if (!payload.to) {
    return problem(
      422,
      "This customer has no email address. Send this one on WhatsApp instead.",
    );
  }

  let attachments: { filename: string; content: Uint8Array }[] | undefined;
  if (payload.attachmentUrl) {
    try {
      const file = await fetch(payload.attachmentUrl);
      if (!file.ok) throw new Error("fetch failed");
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Checked again here rather than trusted from upload: the row could
      // have been written before the limit existed, and an oversized
      // attachment bounces at every recipient's provider rather than failing
      // once, visibly, here.
      if (bytes.byteLength > MAX_CAMPAIGN_BYTES) {
        return problem(413, "That PDF is too big to email. Nothing was sent.");
      }
      attachments = [
        { filename: payload.attachmentName ?? "menu.pdf", content: bytes },
      ];
    } catch {
      return problem(502, "Couldn't fetch the attachment. Nothing was sent.");
    }
  }

  const subject =
    payload.subject?.trim() || `A note from ${payload.orgName || "the kitchen"}`;

  const sent = await sendEmail({
    to: payload.to,
    subject,
    text: payload.body,
    html: htmlOf(payload.body),
    // From a Sous domain, always. Sending "from" her Gmail is spoofing: it
    // fails DMARC and lands in spam, which is worse than not sending.
    from,
    // …so a reply reaches HER, which is the entire point of writing to
    // somebody.
    replyTo: payload.replyTo,
    ...(attachments ? { attachments } : {}),
  });
  if (!sent.ok) return problem(502, sent.message);

  // Only after it actually left. Stamping sent on a failed send is the one
  // lie that would make the queue worthless.
  await convex.mutation(api.messages.markSent, {
    orgSlug,
    outboxId: outboxId as Id<"outbox">,
  });

  return Response.json({ ok: true, to: payload.to, resent: false });
}

/**
 * Her words as HTML.
 *
 * Escaped, then paragraphed on blank lines. She types plain text into a
 * template and an ampersand in "Pies & Cakes" must not become markup — the
 * body is data, and the only structure it carries is where she pressed
 * return.
 */
function htmlOf(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br />")}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">${paragraphs}</div>`;
}

/** Plain sentences, not codes. The queue renders this text verbatim. */
function problem(status: number, message: string) {
  return Response.json({ ok: false, message }, { status });
}
