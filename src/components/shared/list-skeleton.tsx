import { Skeleton } from "@/components/ui/skeleton";

/**
 * Six skeleton rows matching the ItemRow layout (checkbox + text + actions).
 * Used inside Suspense boundaries on `(app)/lists/page.tsx` and
 * `(app)/lists/[id]/page.tsx` while server-side data is loading.
 */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading list">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-[var(--lg-border)] px-4"
          style={{ minHeight: 56 }}
        >
          <Skeleton className="h-[22px] w-[22px] rounded-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * Variant for the lists-of-lists page (emoji + name).
 */
export function ListsListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading lists">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-[var(--lg-border)] px-4"
          style={{ minHeight: 56 }}
        >
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-4 w-2/5" />
        </div>
      ))}
    </div>
  );
}
