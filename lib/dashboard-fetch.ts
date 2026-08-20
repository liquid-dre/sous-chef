import "server-only";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { boundsForDay, dayInTimeZone, type PeriodKey } from "./period";

/**
 * Home's claim, fetched and rendered on the SERVER.
 *
 * The whole point is the 3G budget. Measured on a production build at 3G with
 * a mid-range Android's CPU, the client-rendered sentence took 6.4s to appear
 * — not because anything is slow, but because it could not paint until 531KB
 * of JavaScript had downloaded, parsed and hydrated. The same page without CPU
 * throttling managed 347ms. Putting the sentence in the initial HTML takes the
 * bundle off the critical path for the one thing she opened Sous to read.
 *
 * "The server has no today" still holds (CONTEXT.md). This never guesses: it
 * uses a timezone the BROWSER reported on a previous visit, and returns null
 * when it has none — the first visit ever falls back to the client path, and
 * every visit after that is server-rendered.
 */

/** Written by components/dashboard/remember-timezone.tsx. */
export const TZ_COOKIE = "sous_tz";

export interface ServerClaim {
  /** Her today, as the server understood it. Seeds PeriodProvider so the
   * hydrating client agrees about which month this is. */
  day: string;
  period: PeriodKey;
  data: Awaited<ReturnType<typeof fetchClaim>> extends null
    ? never
    : NonNullable<Awaited<ReturnType<typeof fetchClaim>>>["data"];
}

async function fetchClaim(orgSlug: string, period: PeriodKey) {
  const timeZone = (await cookies()).get(TZ_COOKIE)?.value;
  // No timezone means we do not know what day it is for her, and a wrong month
  // boundary on the 1st is exactly the sort of quiet error this product
  // refuses. Fall back to the client, which does know.
  if (!timeZone) return null;
  const day = dayInTimeZone(timeZone);
  if (!day) return null;

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;

  try {
    const { getToken } = await auth();
    const jwt =
      (await getToken({ template: "convex" }).catch(() => null)) ??
      (await getToken());
    if (!jwt) return null;

    const client = new ConvexHttpClient(url);
    client.setAuth(jwt);
    const bounds = boundsForDay(period, day);

    // A DEADLINE, because this sits in front of the first byte. Server
    // rendering trades client work for server work, and without a bound that
    // trade can go the wrong way: a slow Convex would hold the HTML back and
    // leave her looking at nothing at all, which is worse than the skeleton
    // she used to get. Past the deadline we give up and let the client do what
    // it did before — the optimisation is allowed to fail, never to delay.
    const data = await Promise.race([
      client.query(api.dashboard.claim, {
        orgSlug,
        start: bounds.start,
        end: bounds.end,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_200)),
    ]);
    if (!data) return null;
    return { day, period, data };
  } catch {
    // Any failure here is a PERFORMANCE optimisation that did not happen, not
    // an error the customer should see. The client path renders the same
    // screen a moment later.
    return null;
  }
}

export async function serverClaim(
  orgSlug: string,
  period: PeriodKey = "month",
) {
  return fetchClaim(orgSlug, period);
}
