"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Mail,
  ReceiptText,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { firstName, waLink } from "@/lib/whatsapp";
import { ReplaceLinkDialog } from "./replace-link-dialog";

/**
 * The document, from her side.
 *
 * The action set follows what the PLATFORM can do, not a breakpoint. On a
 * phone the OS share sheet already offers copy-link and save-to-files, so
 * duplicating them as buttons wastes the row; on a desktop there is usually no
 * share sheet at all, so those two have to exist. Deciding from a capability
 * check rather than a media query means a desktop browser that does have the
 * API gets the better path, and a phone that does not still gets a working one.
 *
 * Sharing marks it sent; downloading does NOT. That distinction is the whole
 * revision rule: a revision number may only appear on a document a customer
 * could already be holding a different version of, and checking her own PDF is
 * not that.
 */

/** The origin never changes within a page, so there is nothing to subscribe to. */
const subscribeNothing = () => () => {};

/**
 * The input modality CAN change — a keyboard case clipped onto a tablet, a
 * mouse plugged into one — so this is a real subscription rather than a
 * one-shot read.
 */
function subscribeCoarsePointer(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export type DeliveryStatus = "notSent" | "sent" | "viewed";

export interface EmailResult {
  ok: boolean;
  to?: string;
  message?: string;
}

export interface InvoiceCardData {
  invoiceLabel: string | null;
  invoiceToken: string;
  revision: number;
  sentAt: number | null;
  viewedAt: number | null;
  deliveryStatus: DeliveryStatus;
  customerPhone: string | null;
  customerName: string | null;
  /** Null when this customer has no email — the common case, since phone is
   * the identity key. The Email action is omitted rather than disabled. */
  customerEmail: string | null;
  /** False when the kitchen has no sending domain connected yet. */
  emailConfigured: boolean;
  orgName: string;
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A dummy file is the only way to ask whether files can be shared at all. */
function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    return navigator.canShare({
      files: [
        new File([new Uint8Array(1)], "a.pdf", { type: "application/pdf" }),
      ],
    });
  } catch {
    return false;
  }
}

type Capability = "files" | "url" | "none";

type EmailState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; to: string }
  | { kind: "failed"; message: string };

export function InvoiceCard({
  data,
  onIssue,
  onSend,
  onReplaceLink,
  onEmail,
}: {
  data: InvoiceCardData;
  /** Allocates the number. Idempotent. */
  onIssue?: () => Promise<void>;
  /** Allocates if needed, then stamps sentAt. Idempotent. */
  onSend?: () => Promise<void>;
  onReplaceLink?: () => Promise<void>;
  /** Resolves with the outcome rather than throwing: a refused send is a
   * normal result she has to read, not an exception. */
  onEmail?: () => Promise<EmailResult>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [emailState, setEmailState] = React.useState<EmailState>({ kind: "idle" });

  // The link has to be absolute to survive being pasted into WhatsApp, and
  // `window` does not exist on the server — genuinely two different values,
  // which is what useSyncExternalStore is for (same reasoning as
  // components/use-client-today.ts). Safe here specifically because both
  // snapshots return an identical value every call: an unstable snapshot makes
  // React throw and unmount the tree.
  const origin = React.useSyncExternalStore(
    subscribeNothing,
    () => window.location.origin,
    () => "",
  );
  const capability = React.useSyncExternalStore<Capability>(
    subscribeCoarsePointer,
    () => {
      if (typeof navigator === "undefined") return "none";
      if (typeof navigator.share !== "function") return "none";
      // The existence of navigator.share is NOT the question. Desktop Chrome
      // has it, and its share sheet is a worse answer there than "copy the
      // link" — which is what she actually wants at a laptop, and which the
      // sheet path would have removed from the row entirely. A coarse pointer
      // is the honest signal for "the OS sheet is the good path here".
      if (!window.matchMedia("(pointer: coarse)").matches) return "none";
      return canShareFiles() ? "files" : "url";
    },
    // The server render assumes no sheet, so the first paint carries the
    // buttons that always work rather than flashing them away.
    () => "none",
  );

  const url = `${origin}/i/${data.invoiceToken}`;
  const issued = data.invoiceLabel !== null;

  // The PDF, warmed ahead of the tap. iOS throws NotAllowedError if share()
  // is not called inside the user gesture, and a Chromium cold start is far
  // too long to hold one — so the bytes have to be waiting before she taps.
  // Gated on files actually being shareable: on a desktop this would be pure
  // waste, and it is a real cost even on mobile (one browser launch per card).
  const pdfRef = React.useRef<File | null>(null);
  React.useEffect(() => {
    if (capability !== "files" || !issued) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/i/${data.invoiceToken}/pdf`);
        if (!res.ok) return;
        const blob = await res.blob();
        if (!cancelled) {
          pdfRef.current = new File([blob], `${data.invoiceLabel}.pdf`, {
            type: "application/pdf",
          });
        }
      } catch {
        // Falls through to sharing the link, which always works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capability, issued, data.invoiceToken, data.invoiceLabel]);

  const run = async (fn?: () => Promise<void>) => {
    if (!fn || busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const title = `Invoice ${data.invoiceLabel} from ${data.orgName}`;

  const share = async () => {
    // Fire-and-forget so the gesture is not spent awaiting a mutation — iOS
    // is strict about what counts as "inside the click".
    void run(onSend);
    const file = pdfRef.current;
    try {
      if (file && capability === "files") {
        // The only way a FILE reaches WhatsApp: a wa.me deep link cannot
        // attach one, but the OS sheet can hand the app the real PDF.
        await navigator.share({ files: [file], title, text: url });
      } else {
        await navigator.share({ title, text: title, url });
      }
    } catch {
      // AbortError when she closes the sheet. Not a failure, and not
      // something to report back at her.
    }
  };

  const copy = async () => {
    await run(onSend);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (insecure context, or she declined). The link is
      // still reachable through "What they see".
    }
  };

  const sendEmail = async () => {
    if (!onEmail) return;
    setEmailState({ kind: "sending" });
    const result = await onEmail();
    setEmailState(
      result.ok
        ? { kind: "sent", to: result.to ?? "" }
        : { kind: "failed", message: result.message ?? "Nothing was sent." },
    );
  };

  if (!issued) {
    return (
      <section
        aria-label="Invoice"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5"
      >
        <div className="flex items-start gap-3">
          <ReceiptText
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0">
            <h2 className="type-title">No invoice yet</h2>
            <p className="type-body text-muted-foreground">
              Numbers are given out when a document is made, so nothing is used
              up until you need one.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => run(onIssue)}>
            {busy ? "Making it…" : "Make the invoice"}
          </Button>
        </div>
      </section>
    );
  }

  const hi = firstName(data.customerName);
  const waHref = waLink(
    data.customerPhone,
    `Hi${hi ? ` ${hi}` : ""}, here's your invoice ${data.invoiceLabel}: ${url}`,
  );
  const canEmail = Boolean(data.customerEmail && data.emailConfigured && onEmail);

  return (
    <section
      aria-label="Invoice"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="numeric-lg">{data.invoiceLabel}</h2>
        <DeliveryLine data={data} />
      </div>

      {data.revision > 0 && (
        <p className="type-caption text-warn-foreground">
          This changed after you sent it. The copy they have says something
          different, and the new one is marked revision {data.revision}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {capability !== "none" ? (
          <Button size="sm" onClick={share}>
            <Share2 aria-hidden /> Share
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={copy}
            // "Copy link" and "Copied" are different widths, so without a
            // floor the button shrinks under her thumb at the exact moment it
            // is confirming, taking the rest of the row with it.
            className="min-w-[8.25rem] justify-center"
          >
            {copied ? (
              <>
                <Check aria-hidden /> Copied
              </>
            ) : (
              <>
                <Copy aria-hidden /> Copy link
              </>
            )}
          </Button>
        )}

        {waHref && (
          <Button
            size="sm"
            variant="outline"
            asChild
            onClick={() => void run(onSend)}
          >
            <a href={waHref} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </Button>
        )}

        {capability === "none" && (
          // No sheet to save it from, so the file needs its own way out.
          // No onSend: checking her own PDF is not sending it to anyone.
          <Button size="sm" variant="outline" asChild>
            <a
              href={`/i/${data.invoiceToken}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              <Download aria-hidden /> PDF
            </a>
          </Button>
        )}

        {/* Omitted, never disabled. Most customers have no email — phone is
            the identity key — and a permanently greyed button is a question
            with no answer. Same for a kitchen with no sending domain. */}
        {canEmail && (
          <Button
            size="sm"
            variant="outline"
            disabled={emailState.kind === "sending"}
            onClick={sendEmail}
          >
            <Mail aria-hidden />
            {emailState.kind === "sending" ? "Sending…" : "Email"}
          </Button>
        )}
      </div>

      {emailState.kind === "sent" && (
        <p className="type-caption text-profit-foreground">
          Sent to {emailState.to}. A reply comes back to you, not to Sous.
        </p>
      )}
      {emailState.kind === "failed" && (
        // Persistent, not a toast: she has to know it did NOT go, and a
        // message that fades after four seconds is one she can miss.
        <p
          className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground"
          role="alert"
        >
          {emailState.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" asChild>
          <a href={`/i/${data.invoiceToken}`} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> What they see
          </a>
        </Button>
        {onReplaceLink && (
          <ReplaceLinkDialog
            invoiceLabel={data.invoiceLabel!}
            wasViewed={data.viewedAt !== null}
            onReplace={onReplaceLink}
          />
        )}
      </div>
    </section>
  );
}

/**
 * "Sent but not opened" is the row she should chase, so the two facts are one
 * line rather than a badge that only says one of them.
 */
function DeliveryLine({ data }: { data: InvoiceCardData }) {
  if (data.deliveryStatus === "viewed" && data.viewedAt) {
    return (
      <p className="type-caption text-profit-foreground">
        Opened {formatDay(data.viewedAt)}
      </p>
    );
  }
  if (data.deliveryStatus === "sent" && data.sentAt) {
    return (
      <p className="type-caption text-muted-foreground">
        Sent {formatDay(data.sentAt)} · not opened yet
      </p>
    );
  }
  return <p className="type-caption text-muted-foreground">Not sent yet</p>;
}
