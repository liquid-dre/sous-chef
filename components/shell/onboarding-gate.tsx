"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Owners of a provisioned-but-unconfigured kitchen land on the welcome
 * screen before anything else. Staff are never gated — onboarding is owner
 * work. While the query is unresolved (including the pre-SETUP.md phase)
 * this does nothing, harmlessly.
 */
export function OnboardingGate({ orgSlug }: { orgSlug: string }) {
  const theme = useQuery(api.orgs.getTheme, { orgSlug });
  const router = useRouter();
  const pathname = usePathname();
  const welcomePath = `/${orgSlug}/welcome`;

  useEffect(() => {
    if (!theme) return;
    if (
      theme.role === "owner" &&
      theme.provisioned &&
      theme.onboardedAt === null &&
      pathname !== welcomePath
    ) {
      router.replace(welcomePath);
    }
  }, [theme, pathname, welcomePath, router]);

  return null;
}
