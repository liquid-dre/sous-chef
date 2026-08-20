import { Skeleton } from "@/components/ui/skeleton";

/**
 * Segment-level loading boundary: a skeleton in the rough shape of a screen
 * — title, a toolbar, content rows. Never a spinner (DESIGN.md §7).
 */
export function RouteLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-2" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-2/5" />
      <div className="flex gap-3">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-20" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-4/5" />
      </div>
    </div>
  );
}

export default RouteLoading;
