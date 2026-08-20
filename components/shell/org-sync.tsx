"use client";

import { useEffect } from "react";
import { useOrganization, useOrganizationList } from "@clerk/nextjs";

/**
 * Keeps Clerk's active organization in step with the org in the URL, so the
 * Convex JWT always carries the org the route claims. withOrg rejects any
 * mismatch server-side; this just prevents the mismatch from happening on
 * legitimate navigation (bookmarks, the org switcher, multi-tab use).
 */
export function OrgSync({
  orgId,
  orgSlug,
}: {
  orgId: string;
  orgSlug: string;
}) {
  const { organization } = useOrganization();
  const { setActive, isLoaded } = useOrganizationList();

  useEffect(() => {
    if (!isLoaded || !setActive) return;
    if (organization?.slug !== orgSlug) {
      void setActive({ organization: orgId });
    }
  }, [isLoaded, setActive, organization?.slug, orgSlug, orgId]);

  return null;
}
