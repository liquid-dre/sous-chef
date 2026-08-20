"use client";

import * as React from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function subscribeNothing() {
  return () => {};
}

/**
 * The link she posts to her story.
 *
 * WhatsApp will not carry an attachment through a story, so the campaign PDF
 * becomes a URL and this is where she gets it. On a phone that means the OS
 * share sheet, which is the only path that puts a link into a story in one
 * gesture; at a laptop it means the clipboard, because a desktop share sheet
 * is a worse answer than "copy" and would have replaced it.
 *
 * The same capability reasoning as `components/orders/invoice-card.tsx`: the
 * existence of `navigator.share` is not the question, a coarse pointer is.
 */
export function CampaignShare({
  token,
  name,
}: {
  token: string;
  name: string;
}) {
  const [copied, setCopied] = React.useState(false);

  // `window` does not exist on the server — genuinely two different values,
  // which is what useSyncExternalStore is for. Both snapshots are stable per
  // call, which is the condition that makes this safe.
  const origin = React.useSyncExternalStore(
    subscribeNothing,
    () => window.location.origin,
    () => "",
  );
  const sheet = React.useSyncExternalStore(
    subscribeNothing,
    () =>
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
    // The server render assumes no sheet, so the first paint carries the
    // control that always works rather than flashing it away.
    () => false,
  );

  const url = `${origin}/c/${token}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sheet ? (
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-9"
          onClick={async () => {
            try {
              await navigator.share({ title: name, text: name, url });
            } catch {
              // AbortError when she closes the sheet. Not a failure, and not
              // something to report back at her.
            }
          }}
        >
          <Share2 aria-hidden />
          Share the link
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-9"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard refused (insecure context, or she declined). The
              // link is still readable below.
            }
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy the link"}
        </Button>
      )}
      {/* Readable as well as copyable: a link she can see is a link she can
          check before it goes in front of everyone who follows her. */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="type-caption min-w-0 truncate text-muted-foreground underline underline-offset-2"
      >
        {url.replace(/^https?:\/\//, "")}
      </a>
    </div>
  );
}
