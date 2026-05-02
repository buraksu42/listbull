"use client";

import { GripVertical } from "lucide-react";
import * as React from "react";

import { ItemActions } from "@/components/lists/item-actions";
import { Avatar } from "@/components/lists/member-list";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Phase 2 interactive item row + Phase 3 assignee badge.
 *
 * - Circular checkbox (22×22) toggles `isDone` via `onToggle`.
 * - Row body (text) is its own button — tapping opens edit.
 * - Trailing cluster: assignee avatar pill (when assigned) + drag
 *   handle (when reorder mode) + edit + delete actions.
 * - Pending state (network call in flight) drops the row to 60% opacity.
 *
 * Mutation orchestration (debounce, rollback, toast) lives one level up
 * in <ItemList />; this component is purely presentational + dispatches
 * intents.
 *
 * Phase 3: when `item.assigneeId !== null`, we render a 28×28 avatar
 * pill before the action cluster. The parent <ItemList /> resolves the
 * assignee's first name + photo from its `members` Map and passes them
 * via `assigneeFirstName` / `assigneePhotoUrl`. If the member dropped
 * out of the list mid-cycle the badge falls back to a "?" monogram and
 * still renders the assignee_id (the row is functionally still
 * assigned). The aria-label includes "assigned to <name>".
 */
export type ItemRowProps = {
  item: Item;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Truthy when an optimistic mutation hasn't been confirmed yet. */
  pending?: boolean;
  /** Render slot for the drag handle wired to dnd-kit listeners. */
  dragHandle?: React.ReactNode;
  /**
   * Phase 3 — denormalized assignee info supplied by the parent
   * <ItemList /> from its members lookup. Optional: when null the badge
   * is hidden.
   */
  assigneeFirstName?: string | null;
  assigneePhotoUrl?: string | null;
};

export function ItemRow({
  item,
  onToggle,
  onEdit,
  onDelete,
  pending = false,
  dragHandle,
  assigneeFirstName = null,
  assigneePhotoUrl = null,
}: ItemRowProps) {
  const assignedTo =
    item.assigneeId !== null ? assigneeFirstName ?? "?" : null;
  const ariaLabel = [
    item.isDone ? "completed " : "",
    item.text,
    assignedTo ? `, assigned to ${assignedTo}` : "",
  ]
    .join("")
    .trim();

  return (
    <div
      role="listitem"
      aria-label={ariaLabel}
      className={cn(
        "group flex items-center gap-3 border-b border-[var(--lg-border)]",
        "px-4 transition-opacity",
        pending && "opacity-60",
      )}
      style={{ minHeight: 56 }}
    >
      {dragHandle ? (
        <span className="flex h-11 w-7 items-center justify-center text-[var(--lg-muted-fg)]">
          {dragHandle}
        </span>
      ) : (
        <span
          aria-hidden
          className="hidden h-11 w-7 items-center justify-center text-[var(--lg-muted-fg)] opacity-0 transition-opacity group-hover:opacity-100 sm:flex"
        >
          <GripVertical className="h-4 w-4" />
        </span>
      )}

      <Checkbox
        checked={item.isDone}
        onCheckedChange={(next) => onToggle(next)}
        ariaLabel={`Toggle ${item.text}`}
      />

      <button
        type="button"
        onClick={onEdit}
        className={cn(
          "flex-1 truncate text-left",
          "text-[length:var(--lg-fs-lg)] font-normal leading-relaxed",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--lg-bg)] rounded-[var(--lg-r-sm)]",
        )}
        style={{
          color: item.isDone ? "var(--lg-muted-fg)" : "var(--lg-fg)",
          textDecoration: item.isDone ? "line-through" : "none",
        }}
      >
        {item.text}
      </button>

      {item.assigneeId !== null && (
        <span
          aria-hidden
          title={assignedTo ?? undefined}
          className="shrink-0"
        >
          <Avatar
            name={assigneeFirstName}
            photoUrl={assigneePhotoUrl}
            size={28}
          />
        </span>
      )}

      <ItemActions
        onEdit={onEdit}
        onDelete={onDelete}
        itemLabel={item.text}
      />
    </div>
  );
}

/**
 * Custom circular checkbox — keyboard-accessible (Space/Enter), 44×44 tap
 * target around a 22×22 visible disc to satisfy WCAG 2.1.
 */
function Checkbox({
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--lg-r-full)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--lg-bg)]",
      )}
    >
      <span
        aria-hidden
        className="grid h-[22px] w-[22px] place-items-center rounded-full transition-colors"
        style={{
          border: `2px solid ${checked ? "var(--lg-accent)" : "var(--lg-muted-fg)"}`,
          background: checked ? "var(--lg-accent)" : "transparent",
        }}
      >
        {checked && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 6.5l2.5 2.5L10 3.5"
              stroke="var(--lg-accent-fg)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}
