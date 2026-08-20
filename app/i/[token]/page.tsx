import { ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InvoicePreview } from "@/components/invoice/invoice-preview";
import { fetchInvoiceByToken } from "@/lib/invoice-fetch";
import { RecordView } from "./record-view";

/**
 * Public, token-scoped shareable invoice — the customer's copy.
 *
 * Unauthenticated by design: the token IS the authorisation (proxy.ts lists
 * /i/(.*) as public). Unknown token, plain answer, no hint at what exists.
 *
 * `.invoice-paper` pins the light tokens for the whole subtree, so a customer
 * opening this at night on a phone in dark mode sees the same document she
 * screenshotted and the same one the PDF prints.
 */
export default async function InvoiceTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await fetchInvoiceByToken(token);

  if (!data) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-4">
        <EmptyState
          icon={ReceiptText}
          title="This invoice link isn't active"
          body="It may have expired, or the address was mistyped. Ask the kitchen that sent it for a fresh link."
        />
      </main>
    );
  }

  return (
    <main className="invoice-paper min-h-dvh bg-background px-4 py-6 md:px-6 md:py-10">
      {/* After hydration, never on the request — see the component. */}
      <RecordView token={token} />
      <div className="mx-auto w-full max-w-3xl">
        <InvoicePreview data={data} />
        <p className="type-caption pt-4 text-center text-muted-foreground">
          Questions about this invoice? Reply to the kitchen that sent it.
        </p>
      </div>
    </main>
  );
}
