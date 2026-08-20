import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Empty states are a first-class deliverable. DESIGN.md §7.
 *
 * A new kitchen sees empty screens for its entire first week — these ARE the
 * first-week product. Every one names the next action, explains in one
 * sentence what the screen will show once it has data, and never shows a zero
 * as data.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  actionLabel,
  actionHref,
  onAction,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  actionLabel?: string;
  /** When the next action is somewhere else. A real link, not a callback —
   * router.push() in an onClick loses middle-click, open-in-new-tab and
   * prefetch, which is a lot to give up for no gain. */
  actionHref?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {Icon && (
        <Icon aria-hidden className="size-6 text-muted-foreground" strokeWidth={1.5} />
      )}
      <h2 className="type-display-sm text-balance">{title}</h2>
      <p className="type-body max-w-sm text-pretty text-muted-foreground">{body}</p>
      {actionLabel &&
        (actionHref ? (
          <Button className="mt-2" asChild>
            <Link href={actionHref}>{actionLabel}</Link>
          </Button>
        ) : (
          <Button className="mt-2" onClick={onAction}>
            {actionLabel}
          </Button>
        ))}
    </div>
  );
}
