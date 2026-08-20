"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { Eye } from "lucide-react";
import { api } from "@/convex/_generated/api";

/**
 * The strip that says this is not your kitchen.
 *
 * CONTEXT.md — Access: read-only impersonation carries a persistent banner.
 * Persistent means it cannot be dismissed and it is not a toast: it is the
 * first child of the shell's flex column, above the sidebar and above the
 * mobile top bar, on every route for the whole session. A super user reading
 * somebody's margins should never be able to forget whose they are.
 *
 * It states the expiry rather than counting down. A ticking clock in a fixed
 * strip is motion she sees on every screen for thirty minutes, which DESIGN.md
 * §6 rules out for anything seen dozens of times — and the exact second does
 * not change what she would do. The server is the authority on expiry either
 * way (convex/lib/functions.ts).
 *
 * Deliberately NOT the semantic --warn or --danger tokens. Nothing is wrong
 * and nothing is at risk; this is a statement of mode. Warn amber here would
 * be the same colour the pantry uses for a real problem, on every screen, for
 * half an hour — and would teach her to ignore it there.
 */
export function ImpersonationBanner({
  orgName,
  expiresAt,
}: {
  orgName: string;
  expiresAt: number;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = React.useState(false);
  const stop = useMutation(api.admin.stopImpersonation);

  const until = new Date(expiresAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    /**
     * A FIXED height — h-14, matching the mobile top bar it sits above.
     *
     * Not an aesthetic choice. `--banner-h` in app-shell.tsx offsets the fixed
     * mobile bar and the sticky sidebar against this strip, and a variable
     * that disagrees with the real height is worse than no variable at all: at
     * 380px the first draft of this wrapped onto three lines (93px measured)
     * while the variable still claimed 40px, so the top bar sat squarely on
     * top of it. `overflow-hidden` and the truncation below are what keep the
     * number honest as the kitchen name grows.
     */
    <div className="flex h-14 items-center justify-between gap-3 overflow-hidden border-b bg-foreground px-4 text-background md:px-6">
      <p className="type-label flex min-w-0 items-center gap-1.5">
        <Eye aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
        {/* "Read-only" is the whole point of the strip, so it is OUTSIDE the
            truncating span. An earlier draft read "Viewing Rutendo's Kitchen.
            Read-only until 2:34" and truncated at 380px to "Viewing Rutendo's
            Kitchen. R…" — cutting the one word that had to survive. The
            kitchen name is what gives, because by then she knows she is
            somewhere she should not be typing. */}
        <span className="shrink-0">Read-only ·</span>
        <span className="min-w-0 truncate font-semibold">{orgName}</span>
        {/* The expiry goes first when space is short: useful, but not what
            stops her trusting the screen. */}
        <span className="hidden shrink-0 sm:inline">
          until <span className="numeric">{until}</span>
        </span>
      </p>
      {/* Not the design system's Button: every variant is themed for the app's
          surfaces, and none of them reads correctly on the inverted strip. */}
      <button
        type="button"
        disabled={leaving}
        onClick={async () => {
          setLeaving(true);
          try {
            await stop({});
            // Back to /admin rather than to her own kitchen: she came from
            // there, and this route is about to stop resolving for her.
            router.push("/admin");
            router.refresh();
          } finally {
            setLeaving(false);
          }
        }}
        className="type-label inline-flex min-h-11 shrink-0 items-center md:min-h-9 rounded-md border border-background/30 px-3 transition-[background-color,transform] duration-[var(--duration-fast)] ease-out hover:bg-background/10 focus-visible:ring-3 focus-visible:ring-background/50 focus-visible:outline-none active:scale-[0.97]"
      >
        {leaving ? "Leaving…" : "Stop viewing"}
      </button>
    </div>
  );
}
