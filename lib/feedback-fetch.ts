import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * The feedback form's payload, fetched on the SERVER.
 *
 * Server-side rather than through the React client for the reason this whole
 * page exists: her customer is on a phone on a bad connection, and a
 * client-side query would mean opening a websocket before there was anything
 * on the screen to look at. Rendering it server-side means the first byte
 * already carries her branding and the questions.
 *
 * Returns null for every unusable token — expired, mistyped, never issued,
 * belonging to a cancelled order, belonging to another kitchen. The caller
 * renders the same honest sentence for all of them and never hints at which.
 */
export async function fetchFeedbackByToken(token: string) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  // `||`, not `??`: an unset env var arrives as the empty string, and the
  // client constructor throws on a URL whose subdomain does not parse — which
  // would turn a missing config into a 500 on a customer-facing page.
  if (!url) return null;
  try {
    return await new ConvexHttpClient(url).query(api.feedback.byToken, { token });
  } catch {
    // Whatever went wrong, her customer's answer is the same sentence.
    return null;
  }
}
