import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { resolveOrgAccess } from "@/lib/auth/org";
import { composeDigest, type DigestAlert } from "@/lib/alert-digest";
import { mailFrom, sendEmail } from "@/lib/mailer";
import { formatQty, type BaseUnit } from "@/components/pantry/format";

/**
 * The daily alert digest — one email, on demand.
 *
 * NOT SCHEDULED, and that is a stated gap rather than an oversight. There is
 * no `convex/crons.ts`, no `ctx.scheduler`, no action wrapper in
 * `convex/lib/functions.ts` and no `convex/http.ts` in this repo. Wiring a
 * daily trigger means adding an action wrapper — which `enforcement.test.ts`
 * and `eslint.config.mjs` exist to make a deliberate act — plus a
 * shared-secret surface between a scheduler and this route that cannot be
 * exercised in dev at all, because a Convex action cannot reach localhost
 * (see app/api/invoice/email/route.ts:11-17). Turning this into a daily job
 * is one cron entry pointing at this URL; the payload and the words are here
 * and testable now.
 *
 * Tenancy ends in Convex, exactly as the invoice route does: this handler
 * reads through an org-scoped query using the CALLER'S OWN JWT, and the
 * recipient comes from the org profile, never from the request body. A route
 * that accepted `to:` from the browser would be a spam relay wearing her
 * domain's reputation.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: { orgSlug?: string; today?: string };
  try {
    body = await request.json();
  } catch {
    return problem(400, "That request didn't make sense.");
  }
  const { orgSlug, today } = body;
  if (!orgSlug || !today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return problem(400, "That request didn't make sense.");
  }

  // The same silence every other route gives a non-member.
  const access = await resolveOrgAccess(orgSlug);
  if (!access) return problem(404, "Not found.");

  const from = mailFrom();
  if (!from) {
    return problem(503, "Email isn't set up for this kitchen yet.");
  }

  const { getToken } = await auth();
  const jwt =
    (await getToken({ template: "convex" }).catch(() => null)) ??
    (await getToken());
  if (!jwt) return problem(401, "Sign in again.");

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return problem(503, "This kitchen isn't connected yet.");
  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(jwt);

  let payload;
  try {
    payload = await convex.query(api.alerts.digest, { orgSlug, today });
  } catch {
    return problem(404, "Not found.");
  }

  if (!payload.to) {
    // Her own address, from the org profile. Without one there is nowhere to
    // send it, and inventing a recipient is exactly what this must not do.
    return problem(503, "Add an email address in Settings and Sous can send this.");
  }

  const composed = composeDigest({
    kitchenName: payload.kitchenName,
    today: payload.today,
    horizonEnd: payload.horizonEnd,
    orderCount: payload.orderCount,
    demandBatches: payload.demandBatches,
    trust: payload.trust,
    daysSinceCount: payload.daysSinceCount,
    // Quantities are rendered in HER units here rather than in the engine,
    // for the same reason every other surface does it at the edge: milli is
    // a storage decision, never a thing she reads.
    alerts: payload.alerts.map(
      (a): DigestAlert => ({
        name: a.name,
        severity: a.severity,
        shortfall: formatQty(a.shortfallMilli, a.baseUnit as BaseUnit),
        onHand: formatQty(a.onHandMilli, a.baseUnit as BaseUnit),
        booked: formatQty(a.bookedMilli, a.baseUnit as BaseUnit),
        daysOfCover: a.daysOfCover,
      }),
    ),
  });

  const sent = await sendEmail({
    to: payload.to,
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
    from,
    replyTo: null,
  });
  if (!sent.ok) return problem(502, sent.message);

  return Response.json({ ok: true, subject: composed.subject });
}

function problem(status: number, message: string) {
  return Response.json({ ok: false, message }, { status });
}
