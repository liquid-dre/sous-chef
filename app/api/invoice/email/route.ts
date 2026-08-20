import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { resolveOrgAccess } from "@/lib/auth/org";
import { renderInvoicePdf } from "@/lib/pdf/render-invoice";
import { composeInvoiceEmail } from "@/lib/invoice-email";
import { mailFrom, sendInvoiceEmail } from "@/lib/mailer";

/**
 * Email the invoice, with the PDF attached.
 *
 * It lives in Next rather than Convex because the PDF only exists inside
 * headless Chromium and a Convex action cannot run a browser. The alternative
 * — an action fetching /i/[token]/pdf over HTTP — cannot reach localhost from
 * Convex's cloud, which would make email untestable locally forever.
 *
 * Tenancy still ends in Convex. This handler reads and writes through
 * org-scoped functions using the CALLER'S OWN JWT, so it can reach exactly
 * what she can reach and nothing else. In particular the recipient comes from
 * `deliveryPayload`, never from the request body: a route that accepted `to:`
 * from the browser would be a spam relay wearing her domain's reputation, and
 * that reputation is the only thing keeping her invoices out of junk folders.
 */

export const runtime = "nodejs";
// Chromium plus an API round trip. The 15s some platforms default to is not
// enough, and a timeout here looks to her like the email silently vanishing.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: { orgSlug?: string; orderId?: string };
  try {
    body = await request.json();
  } catch {
    return problem(400, "That request didn't make sense.");
  }
  const { orgSlug, orderId } = body;
  if (!orgSlug || !orderId) return problem(400, "That request didn't make sense.");

  // The same silence every other route gives a non-member: never confirm that
  // something exists to someone who should not know.
  const access = await resolveOrgAccess(orgSlug);
  if (!access) return problem(404, "Not found.");

  if (!mailFrom()) {
    // Honest degradation. The card hides the action when email isn't set up,
    // so reaching this means config changed under her — say so plainly rather
    // than reporting a send that never happened.
    return problem(
      503,
      "Email isn't set up for this kitchen yet. Share the link instead.",
    );
  }

  // Clerk's Convex identity. SETUP.md documents both the session-token path
  // (aud "convex") and a named JWT template, so this has to survive either.
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
    payload = await convex.query(api.invoices.deliveryPayload, {
      orgSlug,
      orderId: orderId as Id<"orders">,
    });
  } catch {
    // Covers NOT_FOUND (another kitchen's order) and NOT_ISSUED (no document
    // yet) alike — neither is something the caller should be able to tell
    // apart from the outside.
    return problem(404, "Not found.");
  }

  if (!payload.to) {
    return problem(
      422,
      "This customer has no email address. Share the link instead.",
    );
  }

  const origin = request.nextUrl.origin;
  const composed = composeInvoiceEmail({
    to: payload.to,
    label: payload.label,
    orgName: payload.orgName,
    customerName: payload.customerName,
    balanceCents: payload.balanceCents,
    totalCents: payload.totalCents,
    invoiceUrl: `${origin}/i/${payload.token}`,
    cancelled: payload.cancelled,
  });

  let pdf: Uint8Array;
  try {
    pdf = await renderInvoicePdf(payload.token, origin);
  } catch {
    return problem(502, "Couldn't build the PDF. Nothing was sent.");
  }

  const sent = await sendInvoiceEmail({
    composed,
    pdf,
    // From a Sous domain, always. Sending "from" her Gmail is spoofing: it
    // fails DMARC and lands in spam, which is worse than not sending.
    from: mailFrom()!,
    // …so a reply has to reach HER, or the invoice is unanswerable.
    replyTo: payload.replyTo,
  });
  if (!sent.ok) {
    return problem(502, sent.message);
  }

  // Only after it actually left. Stamping sent on a failed send would be the
  // one lie that makes the delivery status worthless.
  await convex.mutation(api.invoices.markSent, {
    orgSlug,
    orderId: orderId as Id<"orders">,
  });

  return Response.json({ ok: true, to: payload.to });
}

/** Plain sentences, not codes. The card renders this text verbatim. */
function problem(status: number, message: string) {
  return Response.json({ ok: false, message }, { status });
}
