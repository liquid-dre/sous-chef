/**
 * The customer identity key (CONTEXT.md — Orders), normalised.
 *
 * Formatting only: strip everything that isn't a digit, keeping a leading
 * `+`. "+263 71 555 0184" and "+263715550184" are the same person and must
 * resolve to one customer record.
 *
 * Deliberately NOT doing local-to-international inference — turning
 * "0715550184" into "+263715550184" guesses a country, and a wrong guess
 * silently merges two people. If that inference is wanted it is a product
 * decision with a country setting behind it, not something this function
 * should do quietly.
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** Digits only, for matching a typed query against a stored number. */
export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}
