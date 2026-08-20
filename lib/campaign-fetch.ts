import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export type CampaignPage = NonNullable<
  Awaited<ReturnType<typeof fetchCampaignByToken>>
>;

/**
 * The public campaign page's data, fetched on the SERVER.
 *
 * Server-side for the same reason `lib/invoice-fetch.ts` is: this link is
 * pasted into an Instagram story and opened by a stranger on a phone, and the
 * first byte should already carry the kitchen's name rather than an empty
 * shell waiting on a websocket.
 *
 * Returns null for every unusable token — mistyped, replaced, never issued.
 * The page renders one honest sentence for all of them and never hints at
 * which, because the difference is only useful to somebody guessing.
 */
export async function fetchCampaignByToken(token: string) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  // `||`, not `??`: an unset env var arrives as the empty string, and the
  // client constructor throws on a URL whose subdomain does not parse — which
  // would turn a missing config into a 500 on a customer-facing page.
  if (!url) return null;

  try {
    return await new ConvexHttpClient(url).query(api.messages.campaignByToken, {
      token,
    });
  } catch {
    return null;
  }
}
