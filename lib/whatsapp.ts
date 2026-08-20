import { phoneDigits } from "./phone";

/**
 * wa.me deep links, and nothing else.
 *
 * CONTEXT.md — Comms is unambiguous: "WhatsApp is wa.me deep links only. No
 * Business API, no templates, no Meta verification. Sous composes, WhatsApp
 * opens prefilled, she sends from her number." So this builds a URL and that
 * is the whole of it — there is no send function here and there must never
 * be one, because nothing in Sous auto-sends.
 *
 * Lifted from the copy inlined at `components/orders/invoice-card.tsx:266`;
 * the customer reminders would have been the second, which is the point at
 * which a private copy stops being cheaper than a shared one.
 */

/** Null when there is no number to reach them on — every caller treats that
 * as "hide the action" rather than rendering a dead link. */
export function waLink(phone: string | null, text: string): string | null {
  const digits = phoneDigits(phone ?? "");
  if (digits === "") return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Her greeting, first name only. "Hi Andre Dingiswayo," reads like a bank. */
export function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * The reorder reminder, drafted.
 *
 * DRAFTED, not sent — she reads it in WhatsApp and can change every word
 * before it goes. So it opens a conversation rather than closing a sale: it
 * says what she remembers and asks a question, and it never mentions a price
 * or pressures a date.
 *
 * It deliberately does NOT name the occasion back at them. "Your birthday is
 * coming up" from a bakery reads as surveillance; "this time last year you
 * ordered the chocolate cake" reads as someone who remembers them.
 */
export function reorderDraft(args: {
  customerName: string;
  itemName: string | null;
  lastOrderedOn: string;
}): string {
  const hi = firstName(args.customerName);
  const when = new Date(args.lastOrderedOn).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const what = args.itemName ? `the ${args.itemName.toLowerCase()}` : "something";
  return `Hi${hi ? ` ${hi}` : ""}, this time last year you ordered ${what} for ${when}. Would you like me to make it again?`;
}
