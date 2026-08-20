"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { usePalette } from "@/components/theme/theme-provider";

/**
 * Dresses the app in the kitchen's saved palette once it loads. First paint
 * wears the default palette; this settles it once — a single, quiet swap.
 * While Convex is unconfigured the query never resolves and nothing happens.
 */
export function OrgTheme({ orgSlug }: { orgSlug: string }) {
  const theme = useQuery(api.orgs.getTheme, { orgSlug });
  const { palette, setPalette } = usePalette();
  const applied = React.useRef(false);

  React.useEffect(() => {
    if (applied.current || !theme?.palette) return;
    applied.current = true;
    if (JSON.stringify(theme.palette) !== JSON.stringify(palette)) {
      setPalette(theme.palette);
    }
  }, [theme?.palette, palette, setPalette]);

  return null;
}
