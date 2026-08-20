"use client";

import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Segment-level error boundary: plain language, says what she can do, never
 * dead-ends (DESIGN.md §7). Her data lives server-side — a render error here
 * never means loss, and saying so matters more than the stack trace.
 */
export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <CloudOff aria-hidden className="size-6 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="type-display-sm text-balance">This screen hit a problem</h2>
      <p className="type-body max-w-sm text-pretty text-muted-foreground">
        Your kitchen&apos;s data is safe — this is a display problem, not a data
        problem. Try again; if it keeps happening, moving to another screen and
        back usually clears it.
      </p>
      <Button variant="outline" className="mt-2" onClick={reset}>
        Try again
      </Button>
      {error.digest && (
        <p className="type-caption text-muted-foreground">Ref {error.digest}</p>
      )}
    </div>
  );
}

export default RouteError;
