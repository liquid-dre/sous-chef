/**
 * The super-user allowlist: SOUS_SUPER_USER_IDS, comma-separated Clerk user
 * IDs. Read by the proxy and the /admin pages; convex/lib/functions.ts keeps
 * its own copy because Convex functions run with their own env.
 */
export function isSuperUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return (process.env.SOUS_SUPER_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}
