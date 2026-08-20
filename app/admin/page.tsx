import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { isSuperUser } from "@/lib/auth/super-user";
import { listClerkOrgs } from "@/lib/admin/clerk-orgs";
import { AdminContainer } from "@/components/admin/admin-container";
import { ModeToggle } from "@/components/theme/mode-toggle";

/** Session-dependent — never prerendered. */
export const dynamic = "force-dynamic";

/**
 * The super-user console. Outside org scope entirely: it is a sibling of
 * app/[orgSlug], so none of the org shell's chrome applies and it carries its
 * own header.
 *
 * The proxy already rewrites /admin to a 404 for anyone not on the allowlist;
 * this re-check keeps the page safe if the route is ever reached another way,
 * and `notFound()` rather than a permission page means /admin never confirms
 * it exists to somebody who should not know (CONTEXT.md — Access).
 */
export default async function AdminPage() {
  const { userId } = await auth();
  if (!isSuperUser(userId)) notFound();

  // Server-side: this needs CLERK_SECRET_KEY, which must never reach a
  // browser. The Sous half is a live Convex query inside the container.
  const clerkOrgs = await listClerkOrgs();

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3 md:px-6">
        <div className="flex items-baseline gap-2">
          <span className="type-flourish text-primary" aria-hidden>
            Sous
          </span>
          <span className="type-caption text-muted-foreground">admin</span>
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserButton />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
        <div>
          <h1 className="type-display">Kitchens</h1>
          <p className="type-body text-muted-foreground">
            Every kitchen on Sous, what it pays, and what it is allowed to do.
          </p>
        </div>
        <AdminContainer clerkOrgs={clerkOrgs} />
      </main>
    </div>
  );
}
