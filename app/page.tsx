import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ChefHat } from "lucide-react";
import { firstOrgSlug } from "@/lib/auth/org";
import { EmptyState } from "@/components/empty-state";

/** Session-dependent — never prerendered. */
export const dynamic = "force-dynamic";

/** Signed out → sign-in. Signed in → your kitchen. In a kitchenless limbo
 * (provisioning hasn't happened), say so plainly rather than erroring. */
export default async function RootPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const slug = await firstOrgSlug();
  if (slug) redirect(`/${slug}`);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <p className="type-flourish text-primary" aria-hidden>
        Sous
      </p>
      <EmptyState
        icon={ChefHat}
        title="Your kitchen isn't set up yet"
        body="You're signed in, but no kitchen is linked to this account. If you're expecting one, the person who set up Sous for you can add you to it."
      />
    </main>
  );
}
