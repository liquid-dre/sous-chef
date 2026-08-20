import type { NextRequest } from "next/server";
import { renderInvoicePdf } from "@/lib/pdf/render-invoice";
import { fetchInvoiceByToken } from "@/lib/invoice-fetch";

/**
 * The invoice as a PDF.
 *
 * It does not render anything. It points a real browser at /i/[token]/print —
 * the same component, the same stylesheet, the same fonts — and prints the
 * page. That is the whole design: there is no second layout to drift from the
 * first, because there is no second layout.
 *
 * Public, because the token is the authorisation and proxy.ts already lists
 * /i/(.*) as public. Whoever holds the link can already read the invoice on
 * screen; this hands them the same thing as a file.
 */

// Explicit, though it is the default: this needs node:fs to find Chromium and
// a real process to run it. The edge runtime has neither.
export const runtime = "nodejs";
// Chromium is slower than the 15s default some platforms apply.
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/i/[token]/pdf">,
) {
  // `params` is a Promise in Next 16 — synchronous access was removed, not
  // merely deprecated.
  const { token } = await ctx.params;

  // Resolve first, so an unknown token costs a database read rather than a
  // browser launch, and so the 404 is a 404 rather than an empty PDF.
  const invoice = await fetchInvoiceByToken(token);
  if (!invoice) {
    return new Response("This invoice link isn't active.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const label = `${invoice.invoice.prefix}-${String(invoice.invoice.number).padStart(4, "0")}`;
  // The same renderer the email attachment uses, so the file she checks and
  // the file her customer receives are the same bytes.
  const bytes = await renderInvoicePdf(token, request.nextUrl.origin);

  // Buffered, never streamed. Once streaming begins the status and headers are
  // already sent, so a failure part-way through could not become a 500 — it
  // would be a truncated file the customer's reader silently mangles.
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${label}.pdf"`,
      "Content-Length": String(bytes.length),
      // The document changes when a payment lands or an edit bumps the
      // revision, and it is the version she just sent that matters.
      "Cache-Control": "no-store",
    },
  });
}
