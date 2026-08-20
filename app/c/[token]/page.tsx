import Image from "next/image";
import { Megaphone } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { fetchCampaignByToken } from "@/lib/campaign-fetch";
import { deriveThemeVars } from "@/lib/theme/derive";

/**
 * Public, token-scoped campaign page — what her WhatsApp story links to.
 *
 * WhatsApp will not carry an attachment through a story, so a campaign PDF
 * needs a URL. The honest options were a bare Convex storage link or this.
 * A raw storage URL is a stranger's first impression of her business rendered
 * as a hostname she does not own, and it cannot be withdrawn once posted;
 * this can, because `messages.replaceCampaignToken` burns the token and the
 * old link stops resolving.
 *
 * A SERVER component with her palette inlined on its own root, exactly as
 * `/f/[token]` does it: her colour before any JavaScript runs, and the word
 * "Sous" nowhere on the page.
 *
 * One thing to do. The download is the only control, and it is a plain
 * anchor — no interstitial, no email capture, no "open in app".
 */
export default async function CampaignTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await fetchCampaignByToken(token);

  if (!data) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-4">
        <EmptyState
          icon={Megaphone}
          title="This link isn't active"
          body="It may have been replaced, or the address was mistyped. The kitchen that posted it can share a fresh one."
        />
      </main>
    );
  }

  const vars = deriveThemeVars(data.palette) ?? {};

  return (
    <main
      style={vars as React.CSSProperties}
      className="min-h-dvh bg-background px-4 py-10 md:py-16"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 text-center">
        {data.logoUrl && (
          <Image
            src={data.logoUrl}
            alt=""
            width={64}
            height={64}
            className="size-16 rounded-full object-cover"
            unoptimized
          />
        )}
        <div className="flex flex-col gap-2">
          <p className="type-caption text-muted-foreground">
            {data.kitchenName}
          </p>
          <h1 className="type-display-sm text-balance">{data.name}</h1>
        </div>

        <p className="type-body max-w-sm text-pretty text-muted-foreground">
          {data.body}
        </p>

        {data.fileUrl ? (
          // `download` rather than a viewer: on a phone the OS opens the PDF
          // better than any embed, and an iframe here would be a grey box on
          // half the handsets that reach this page.
          <a
            href={data.fileUrl}
            download
            className="type-label inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Open the menu
          </a>
        ) : (
          <p className="type-caption text-muted-foreground">
            Message {data.kitchenName} to order.
          </p>
        )}
      </div>
    </main>
  );
}
