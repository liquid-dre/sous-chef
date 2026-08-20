"use client";

import * as React from "react";

/**
 * Tell the server which timezone she is in, once, so the NEXT page load can
 * render her claim sentence into the HTML instead of waiting for JavaScript.
 *
 * A timezone rather than a day, deliberately: a day goes stale overnight and
 * would have the server rendering yesterday's month boundary, while a timezone
 * stays true and lets the server work out her today at request time. It is
 * also the smaller admission — it says where she is, not when she last looked.
 *
 * Renders nothing, and the first visit is unaffected: with no cookie the
 * server declines to guess and the client renders as before.
 */
export function RememberTimezone() {
  React.useEffect(() => {
    let timeZone: string;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!timeZone) return;
    // Lax so it travels on normal navigation but not on cross-site requests;
    // a year because a timezone is not news. Not httpOnly — the browser is
    // the one thing that legitimately knows this, and nothing is protected by
    // hiding it.
    document.cookie = `sous_tz=${encodeURIComponent(timeZone)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);

  return null;
}
