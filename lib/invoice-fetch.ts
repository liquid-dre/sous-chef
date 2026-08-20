import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { InvoicePreviewData } from "@/components/invoice/invoice-preview";

/**
 * The customer's invoice, fetched on the SERVER.
 *
 * Server-side rather than through the React client on purpose: the print page
 * is loaded by headless Chromium to make the PDF, and a client-side query
 * would mean racing a websocket connection before the paper had any content
 * on it. Rendering it server-side means the HTML Chromium receives is already
 * the finished document.
 *
 * Returns null for every unusable token — expired, mistyped, never issued,
 * belonging to another kitchen. The caller renders the same honest sentence
 * for all of them and never hints at which.
 */
export async function fetchInvoiceByToken(
  token: string,
): Promise<InvoicePreviewData | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  // `||`, not `??`: an unset env var arrives as the empty string, and the
  // client constructor throws on a URL whose subdomain does not parse — which
  // would turn a missing config into a 500 on a customer-facing page.
  if (!url) return null;

  try {
    const data = await new ConvexHttpClient(url).query(api.invoices.byToken, {
      token,
    });
    if (!data) return null;
    // Shaped for the component here rather than on the server, so
    // convex/invoices.ts stays free to name its fields for the domain.
    return {
      org: data.org,
      invoice: data.invoice,
      customer: data.customer,
      orderDate: data.orderDate,
      deliveryDate: data.deliveryDate,
      cancelled: data.cancelled,
      lines: data.lines,
      deliveryFeeCents: data.deliveryFeeCents,
      discountCents: data.discountCents,
      tax: data.tax,
      depositPercent: data.depositPercent,
      payments: data.payments,
      paymentInstructions: data.paymentInstructions,
      terms: data.terms,
      zwgRateMilli: data.zwgRateMilli,
    };
  } catch {
    // A token that cannot be resolved is not an error page. Whatever went
    // wrong, the customer's answer is the same sentence.
    return null;
  }
}
