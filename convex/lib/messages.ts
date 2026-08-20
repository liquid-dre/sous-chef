/**
 * Templates, recipients, and the rules that stop a broken message going out.
 *
 * Everything in Sous until now has produced a number she reads. This produces
 * words that leave the building under her own name and her own phone number,
 * which makes the failure modes different in kind: a wrong margin is a bad
 * afternoon, and "Hi Chipo, your  is ready" sent to forty people is her
 * looking incompetent to her whole customer list at once.
 *
 * Three rules follow from that, and they are all the same rule:
 *
 * 1. **A message goes out whole or not at all.** A token with no value for a
 *    given recipient removes that RECIPIENT from the batch — it never renders
 *    as a blank or as a literal `{item}`. The scope already requires the
 *    recipient list to show who is excluded and why; an unfillable token is
 *    simply another reason on that list.
 * 2. **Consent is checked here, not at the call site.** It is the gate with a
 *    statute behind it (POPIA, Zimbabwe's Data Protection Act), and a gate
 *    every caller has to remember is a gate that gets forgotten.
 * 3. **Nothing is resolved that was not asked for.** A body with no `{item}`
 *    never excludes anybody for lacking an item to fill it with.
 *
 * Pure: no Convex, no clock. Her day always arrives as an argument, because
 * the server runs UTC and has no "today" (lib/day.ts).
 */

// --- Tokens ---------------------------------------------------------------

export const TOKENS = ["name", "item", "date", "balance"] as const;
export type Token = (typeof TOKENS)[number];

/** `{name}`, `{item}`, `{date}`, `{balance}` — nothing else is substituted. */
const TOKEN_PATTERN = /\{(name|item|date|balance)\}/g;

/**
 * Which tokens this body actually uses.
 *
 * Load-bearing rather than an optimisation: a body that never says `{item}`
 * must not exclude the six customers who have never ordered. Resolution is
 * scoped to what was asked for.
 */
export function tokensIn(body: string): Token[] {
  const found = new Set<Token>();
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    found.add(match[1] as Token);
  }
  // Declaration order, so two bodies using the same tokens report them the
  // same way and a test can compare without sorting.
  return TOKENS.filter((t) => found.has(t));
}

export interface RecipientFacts {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  marketingConsent: boolean;
  /** What they last bought. Null when they have never ordered. */
  lastItemName: string | null;
  /** What they still owe, in cents. ZERO IS A REAL VALUE — "you owe nothing"
   * is a sentence Sous can write. Null would mean "we do not know", which
   * cannot happen: a customer with no orders owes zero. */
  balanceCents: number;
}

export type Filled = { ok: true; text: string } | { ok: false; missing: Token[] };

function money(cents: number): string {
  const abs = Math.abs(cents) / 100;
  return `${cents < 0 ? "−" : ""}$${abs.toFixed(2)}`;
}

/**
 * One recipient's message, or the tokens that could not be filled.
 *
 * `{date}` is NOT per recipient — it comes from the message itself, because
 * "taking orders for Wednesday" is a fact about the Wednesday and not about
 * the person reading it. It is the one token she types.
 */
export function fillTokens(
  body: string,
  facts: RecipientFacts,
  messageDate: string | null,
): Filled {
  const wanted = tokensIn(body);
  const missing: Token[] = [];

  const values: Record<Token, string | null> = {
    // A customer row cannot exist without a name, but an empty string would
    // still produce "Hi ," so it is treated as missing rather than trusted.
    name: facts.name.trim() || null,
    item: facts.lastItemName?.trim() || null,
    date: messageDate?.trim() || null,
    // Deliberately not `|| null` — zero is a value, and `0 || null` is null.
    balance: money(facts.balanceCents),
  };

  for (const token of wanted) {
    if (values[token] === null) missing.push(token);
  }
  if (missing.length > 0) return { ok: false, missing };

  const text = body.replace(TOKEN_PATTERN, (_, token: Token) => values[token]!);
  return { ok: true, text };
}

// --- Who gets it ----------------------------------------------------------

export type ExclusionReason =
  | { kind: "optedOut" }
  | { kind: "noChannel"; channel: "whatsapp" | "email" }
  | { kind: "unfillable"; tokens: Token[] };

export interface Sending {
  customerId: string;
  name: string;
  /** The address the message goes to on this channel. */
  to: string;
  /** Already filled — nothing downstream re-renders the body. */
  body: string;
}

export interface Excluded {
  customerId: string;
  name: string;
  reason: ExclusionReason;
}

/**
 * The recipient list, split.
 *
 * Every exclusion carries its reason, because "sending to 34 of 40" with no
 * explanation is a number she cannot act on — and two of the three reasons
 * are things she can actually fix (add an email, reword the template).
 *
 * The ORDER of the checks is the order of their authority: consent first
 * because it is law, then whether there is any way to reach them at all, then
 * whether the words would come out whole.
 */
export function partitionRecipients(
  recipients: readonly RecipientFacts[],
  body: string,
  channel: "whatsapp" | "email",
  messageDate: string | null,
): { sending: Sending[]; excluded: Excluded[] } {
  const sending: Sending[] = [];
  const excluded: Excluded[] = [];

  for (const r of recipients) {
    if (!r.marketingConsent) {
      excluded.push({ customerId: r.customerId, name: r.name, reason: { kind: "optedOut" } });
      continue;
    }
    const to = channel === "whatsapp" ? r.phone : r.email;
    if (!to || to.trim() === "") {
      excluded.push({
        customerId: r.customerId,
        name: r.name,
        reason: { kind: "noChannel", channel },
      });
      continue;
    }
    const filled = fillTokens(body, r, messageDate);
    if (!filled.ok) {
      excluded.push({
        customerId: r.customerId,
        name: r.name,
        reason: { kind: "unfillable", tokens: filled.missing },
      });
      continue;
    }
    sending.push({ customerId: r.customerId, name: r.name, to, body: filled.text });
  }

  sending.sort((a, b) => a.name.localeCompare(b.name));
  excluded.sort((a, b) => a.name.localeCompare(b.name));
  return { sending, excluded };
}

/** Her words for why somebody is not getting it. */
export function reasonLabel(reason: ExclusionReason): string {
  switch (reason.kind) {
    case "optedOut":
      return "opted out of marketing";
    case "noChannel":
      return reason.channel === "whatsapp" ? "no phone number" : "no email address";
    case "unfillable":
      return `nothing to fill ${reason.tokens.map((t) => `{${t}}`).join(" and ")}`;
  }
}

/** Grouped for the panel: one line per reason with a count, rather than forty
 * lines she has to tally herself. */
export function groupExclusions(
  excluded: readonly Excluded[],
): { label: string; names: string[] }[] {
  const byLabel = new Map<string, string[]>();
  for (const e of excluded) {
    const label = reasonLabel(e.reason);
    const bucket = byLabel.get(label);
    if (bucket) bucket.push(e.name);
    else byLabel.set(label, [e.name]);
  }
  return [...byLabel.entries()]
    .map(([label, names]) => ({ label, names }))
    .sort((a, b) => b.names.length - a.names.length || a.label.localeCompare(b.label));
}

// --- Recurring schedules --------------------------------------------------

const MS_PER_DAY = 86_400_000;

function epochDayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY);
}

/** 1970-01-01 was a Thursday; Sunday = 0, matching orgs.stocktakeDay and
 * Date#getDay. */
export function weekdayOf(day: string): number {
  return (((epochDayOf(day) + 4) % 7) + 7) % 7;
}

/**
 * Which draft this schedule produces today.
 *
 * Scoped to the DAY rather than the week, so "every Sunday" answered on the
 * 9th is answered for the 9th and comes round again on the 16th. The
 * equivalent of `contacts.reminderKey`, and it exists for the same reason:
 * a derived list needs a stable name for one of its entries so a decision
 * about it can be recorded.
 */
export function scheduleKey(scheduleId: string, day: string): string {
  return `${scheduleId}:${day}`;
}

export interface Schedule {
  id: string;
  weekday: number;
  active: boolean;
}

/**
 * Is a draft due from this schedule today?
 *
 * Nothing generates it in advance. The draft exists because today is the day,
 * and its recipients resolve at the moment she opens it — so somebody who
 * opted out this morning is already gone, which a row written at 6am could
 * not manage without a second pass.
 */
export function scheduleDueOn(
  schedule: Schedule,
  today: string,
  answered: ReadonlySet<string>,
): boolean {
  if (!schedule.active) return false;
  if (weekdayOf(today) !== schedule.weekday) return false;
  return !answered.has(scheduleKey(schedule.id, today));
}

export const WEEKDAY_LABEL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * The ceiling on a campaign PDF.
 *
 * A campaign PDF is a flyer she made in Canva, not a book. Ten megabytes is
 * generous for that and small enough that a failed upload on a Harare
 * connection is her mistake to fix rather than a five-minute wait.
 *
 * It lives in this pure module rather than in `convex/files.ts` so the upload
 * form, the mutation that hands out the URL, and the email route that fetches
 * the file back can all agree on one number. Importing it from `files.ts`
 * would drag `_generated/server` into the Next bundle.
 */
export const MAX_CAMPAIGN_BYTES = 10 * 1024 * 1024;
