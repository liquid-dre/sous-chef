/**
 * The daily digest, composed.
 *
 * ONE email a day, never one per event. CONTEXT.md's whole comms posture is
 * that Sous drafts and she decides; a mailbox that pings every time a number
 * crosses a threshold is the fastest possible route to her filtering Sous to
 * a folder, which is the same failure as two wrong reds.
 *
 * Pure — no Resend, no Convex, no clock. The route composes and sends; this
 * file only decides what the words are, so it can be unit tested and so the
 * specimen can render the same text the email will carry.
 *
 * The copy follows the screen's rule exactly: the demand half is a plain
 * statement of fact, and only the supply half ever carries an age. She is
 * reading this on a phone before she goes shopping, so it opens with the
 * thing she has to buy and explains itself afterwards.
 */

export interface DigestAlert {
  name: string;
  severity: "red" | "amber";
  shortfall: string;
  onHand: string;
  booked: string;
  daysOfCover: number | null;
}

export interface DigestInput {
  kitchenName: string;
  today: string;
  horizonEnd: string;
  orderCount: number;
  demandBatches: number;
  /** "trusted" | "hedged" | "dormant" — the pantry's confidence. */
  trust: "trusted" | "hedged" | "dormant";
  daysSinceCount: number | null;
  alerts: DigestAlert[];
}

export interface ComposedDigest {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The one-line summary, which is also the subject. Names what she has to do,
 * never "you have 3 alerts" — a count is not an instruction. */
export function digestHeadline(input: DigestInput): string {
  if (input.trust === "dormant") {
    return `${input.kitchenName}: take a stocktake`;
  }
  if (input.alerts.length === 0) {
    return `${input.kitchenName}: nothing to buy this week`;
  }
  const short = input.alerts.filter((a) => a.severity === "red");
  if (short.length > 0) {
    const names = short.map((a) => a.name.toLowerCase());
    return `${input.kitchenName}: short of ${listWords(names)}`;
  }
  return `${input.kitchenName}: running low on ${listWords(
    input.alerts.map((a) => a.name.toLowerCase()),
  )}`;
}

/** "milk", "milk and flour", "milk, flour and butter". */
function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function demandLine(input: DigestInput): string {
  if (input.orderCount === 0) return "Nothing is booked in the next week.";
  const orders = `${input.orderCount} ${input.orderCount === 1 ? "order" : "orders"}`;
  const batches = `${input.demandBatches} ${input.demandBatches === 1 ? "batch" : "batches"}`;
  return `${orders} before ${input.horizonEnd} need ${batches}.`;
}

/** Present only when the pantry figure is hedged. The demand line above never
 * carries this, because what her orders need does not go stale. */
function stalenessLine(input: DigestInput): string | null {
  if (input.trust === "dormant") {
    return "Two stocktakes have been missed, so Sous has stopped raising pantry alerts rather than raising wrong ones. Take a stocktake and they come back.";
  }
  if (input.trust === "hedged") {
    return input.daysSinceCount === null
      ? "Nothing has been counted yet, so these amounts are worked out from your receipts and recipes rather than confirmed."
      : `These amounts are ${input.daysSinceCount} ${input.daysSinceCount === 1 ? "day" : "days"} of arithmetic since anything was counted.`;
  }
  return null;
}

function alertLine(a: DigestAlert): string {
  const verb = a.severity === "red" ? "Short" : "Getting low";
  const cover =
    a.daysOfCover === null
      ? ""
      : ` About ${a.daysOfCover} ${a.daysOfCover === 1 ? "day" : "days"} left.`;
  return `${verb} — ${a.name}: your orders want ${a.booked}, you have ${a.onHand}.${cover}`;
}

export function composeDigest(input: DigestInput): ComposedDigest {
  const subject = digestHeadline(input);
  const stale = stalenessLine(input);

  const lines: string[] = [demandLine(input)];
  if (input.trust !== "dormant") {
    if (input.alerts.length === 0) {
      lines.push("Everything they need is covered.");
    } else {
      lines.push("");
      for (const a of input.alerts) lines.push(alertLine(a));
    }
  }
  if (stale) {
    lines.push("");
    lines.push(stale);
  }

  const text = lines.join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#221f1a">${lines
    .map((line) =>
      line === ""
        ? "<div style=\"height:12px\"></div>"
        : `<p style="margin:0 0 6px">${escapeHtml(line)}</p>`,
    )
    .join("")}</div>`;

  return { subject, text, html };
}
