import { notFound } from "next/navigation";
import { InvoicePreview } from "@/components/invoice/invoice-preview";
import { fetchInvoiceByToken } from "@/lib/invoice-fetch";

/**
 * The page headless Chromium renders to make the PDF.
 *
 * It is the SAME component, the same stylesheet and the same self-hosted
 * fonts as every other surface — which is the entire reason the PDF and the
 * screen render cannot drift. Nothing here re-implements the invoice; it only
 * takes the chrome off and gives it a page to sit on.
 *
 * `data-invoice-ready` is the signal the route handler waits for, so it never
 * captures a half-laid-out document.
 */
export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await fetchInvoiceByToken(token);
  // A print page for an invoice that does not exist has nothing honest to
  // show, and the route handler turns this into a 404 rather than a blank PDF.
  if (!data) notFound();

  return (
    <main
      data-invoice-ready="true"
      // No border and no rounding: the paper edge IS the page edge. The
      // padding here is the document's margin, which is why the PDF is
      // generated with none of its own.
      className="invoice-paper bg-background"
    >
      <InvoicePreview
        data={data}
        className="rounded-none border-0 bg-background p-10"
      />
    </main>
  );
}
