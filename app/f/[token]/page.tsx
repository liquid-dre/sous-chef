import Image from "next/image";
import { MessageSquareHeart } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PublicFeedbackForm } from "@/components/feedback/public-form";
import { fetchFeedbackByToken } from "@/lib/feedback-fetch";
import { deriveThemeVars } from "@/lib/theme/derive";
import type { SensoryAxis } from "@/convex/lib/feedback";

/**
 * Public, token-scoped feedback capture.
 *
 * Unauthenticated by design: the token IS the authorisation (proxy.ts lists
 * /f/(.*) as public). Unknown token, plain answer, no hint at what exists —
 * an expired link and a mistyped one read identically, because the difference
 * is only useful to somebody guessing.
 *
 * A SERVER component. Her customer is on a phone on a bad connection, and the
 * first byte should already carry her name and the questions rather than an
 * empty shell waiting on a websocket to open.
 *
 * It reads as coming from HER, not from software. Her palette is derived on
 * the server and inlined on this page's own root, so it is her colour before
 * any JavaScript runs — and the word "Sous" appears nowhere on the page.
 */
export default async function FeedbackTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await fetchFeedbackByToken(token);

  if (!data) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-4">
        <EmptyState
          icon={MessageSquareHeart}
          title="This link isn't active"
          body="It may have expired, or it was never quite right. The kitchen that sent it can send a fresh one."
        />
      </main>
    );
  }

  // Derived here rather than through ThemeProvider: this page has no session,
  // no org context, and no reason to ship a provider to a stranger's phone.
  const vars = deriveThemeVars(data.palette) ?? {};

  return (
    <main
      style={vars as React.CSSProperties}
      className="min-h-dvh bg-background px-4 py-8 md:py-12"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
        <header className="flex flex-col items-center gap-3 text-center">
          {data.org.logoUrl && (
            <Image
              src={data.org.logoUrl}
              alt=""
              width={56}
              height={56}
              className="size-14 rounded-full object-cover"
              unoptimized
            />
          )}
          <h1 className="type-display-sm text-balance">
            {data.customerFirstName
              ? `How was it, ${data.customerFirstName}?`
              : "How was it?"}
          </h1>
          <p className="type-body text-pretty text-muted-foreground">
            {data.org.name} would like to know. It takes half a minute, and
            there is nothing to sign up for.
          </p>
        </header>

        {data.alreadySent ? (
          // The token never rotates and one order gets one answer, so this is
          // what a re-opened or forwarded link sees.
          <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-6 py-10 text-center">
            <p className="type-title">Already sent</p>
            <p className="type-body max-w-xs text-pretty text-muted-foreground">
              {data.org.name} has your note from this order. Thank you.
            </p>
          </div>
        ) : (
          // An order whose items have no axes set up still gets the flags and
          // her customer's own words — those are worth having on their own.
          <PublicFeedbackForm
            token={token}
            kitchenName={data.org.name}
            items={data.items.map((item) => ({
              menuItemId: item.menuItemId,
              name: item.name,
              axes: item.axes as SensoryAxis[],
            }))}
          />
        )}
      </div>
    </main>
  );
}
