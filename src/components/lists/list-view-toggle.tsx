import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Phase 16 (Kanban): segmented toggle between list view and board
 * view. URL-driven (`?view=list|board`) so the choice is deep-link-
 * able and survives reload. Server-side render swaps; no client
 * state.
 */
export function ListViewToggle({
  listId,
  current,
}: {
  listId: string;
  current: "list" | "board";
}) {
  return (
    <nav
      aria-label="View"
      className="inline-flex items-center gap-1 rounded-[var(--lb-r-md)] border border-[var(--lb-border)] p-0.5"
    >
      <ToggleLink
        listId={listId}
        view="list"
        active={current === "list"}
        label="Liste"
      />
      <ToggleLink
        listId={listId}
        view="board"
        active={current === "board"}
        label="Pano"
      />
    </nav>
  );
}

function ToggleLink({
  listId,
  view,
  active,
  label,
}: {
  listId: string;
  view: "list" | "board";
  active: boolean;
  label: string;
}) {
  const href =
    view === "list" ? `/lists/${listId}` : `/lists/${listId}?view=board`;
  return (
    <Link
      href={href}
      className={cn(
        "rounded-[var(--lb-r-sm)] px-2 py-1 text-xs",
        active
          ? "bg-[var(--lb-accent)] text-white"
          : "text-[var(--lb-muted-fg)] hover:bg-[var(--lb-card)]",
      )}
    >
      {label}
    </Link>
  );
}
