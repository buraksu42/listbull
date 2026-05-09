"use client";

/**
 * Phase 15: compact item card for week / month / future calendar views.
 *
 * Tap → open the parent list page (Mini App routing). Phase 15 keeps
 * cards link-only — quick-add / drag-between-days deferred to 15.1.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";

type CompactItem = {
  id: string;
  listId: string;
  text: string;
  priority: string;
  status: string;
  isDone: boolean;
  list: { id: string; name: string; emoji: string | null };
};

const PRIORITY_DOT: Record<string, string> = {
  high: "var(--lb-destructive)",
  normal: "var(--lb-muted-fg)",
  low: "var(--lb-border)",
};

export function CompactItemCard({
  item,
  timeLabel,
}: {
  item: CompactItem;
  timeLabel: string;
}) {
  return (
    <Link
      href={`/lists/${item.listId}`}
      className={cn(
        "flex flex-col gap-1 rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-card)] p-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
      )}
      style={{
        opacity: item.isDone ? 0.55 : 1,
      }}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--lb-muted-fg)]">
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: PRIORITY_DOT[item.priority] ?? PRIORITY_DOT.normal,
            }}
          />
          <span className="truncate">
            {item.list.emoji ?? "📋"} {item.list.name}
          </span>
        </span>
        {timeLabel ? <span>{timeLabel}</span> : null}
      </div>
      <p
        className="line-clamp-2 text-sm text-[var(--lb-fg)]"
        style={{
          textDecoration: item.isDone ? "line-through" : "none",
        }}
      >
        {item.text}
      </p>
    </Link>
  );
}
