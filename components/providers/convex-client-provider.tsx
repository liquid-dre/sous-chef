"use client";

import { ReactNode, useMemo } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";

/**
 * Convex client bound to Clerk's JWT ("convex" template). The placeholder URL
 * keeps the shell buildable before SETUP.md has been completed; no Convex
 * call succeeds until NEXT_PUBLIC_CONVEX_URL is real.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(
    () =>
      // `||`, not `??`: an unset env var arrives as the empty string.
      // The fallback must look like a real deployment name ("adj-animal-123")
      // — Convex fatally rejects URLs whose subdomain doesn't parse, and that
      // uncaught error would take the page down with it.
      new ConvexReactClient(
        process.env.NEXT_PUBLIC_CONVEX_URL ||
          "https://unset-placeholder-000.convex.cloud",
      ),
    [],
  );
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
