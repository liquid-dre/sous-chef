"use client";

import * as React from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * "Somebody opened it."
 *
 * This exists as a client component for one reason, and it is the whole
 * design: WhatsApp, Gmail and iMessage all fetch a shared URL to build their
 * preview card. Recording the view on the page REQUEST would therefore fire
 * the instant she pressed send, and "viewed" would mean "sent" — an inverted
 * signal on the one thing she uses to decide whether to chase a debt.
 *
 * Link previewers pull HTML. They do not run React. Firing after mount is the
 * only version of this that means a person looked at it. It also excludes the
 * PDF render for free, because Chromium loads /print, not this page.
 *
 * Colocated with the route rather than in components/invoice/, which
 * convex/enforcement.test.ts keeps free of Convex imports so the preview stays
 * a pure presentational component.
 *
 * It renders nothing, reports nothing, and cannot fail visibly: the customer
 * is here to read an invoice, and none of this is their business.
 */
export function RecordView({ token }: { token: string }) {
  const convex = useConvex();
  // A ref, not state: this must fire once per mount and never cause a render.
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void convex.mutation(api.invoices.recordView, { token }).catch(() => {
      // Offline, blocked, whatever. The invoice still reads perfectly, and a
      // missed view is worth strictly less than a broken page.
    });
  }, [convex, token]);

  return null;
}
