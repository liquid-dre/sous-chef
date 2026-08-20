import Link from "next/link";
import { Button } from "@/components/ui/button";

/** One 404 for everything that doesn't exist — including things that exist
 * for somebody else. It never distinguishes. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="type-flourish text-primary" aria-hidden>
        Sous
      </p>
      <h1 className="type-display-sm text-balance">
        There&apos;s nothing at this address
      </h1>
      <p className="type-body max-w-sm text-pretty text-muted-foreground">
        The link may be mistyped, or whatever was here has moved on.
      </p>
      <Button asChild variant="outline" className="mt-2">
        <Link href="/">Go to your kitchen</Link>
      </Button>
    </main>
  );
}
