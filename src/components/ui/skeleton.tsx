import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Skeleton — shimmer placeholder. The pulse animation is suppressed under
 * prefers-reduced-motion via globals.css's catch-all.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--lg-r-md)] bg-[var(--lg-muted)]",
        className,
      )}
      {...props}
    />
  );
}
