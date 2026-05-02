"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Filter chips — owner-only audit feed (F2).
 *
 * Maps to `?filter=` query semantics on `GET /api/lists/[id]/audit`:
 *   - "all"          (default) every action
 *   - "deletions"    item_deleted, list_archived, member_removed
 *   - "edits"        item_edited, item_due_set, item_due_cleared,
 *                    list_renamed
 *   - "permissions"  member_added, member_removed,
 *                    member_role_changed
 *
 * Wired up by parent (`audit-list.tsx`) which forwards the value into
 * the TanStack queryKey. Backend's filter logic is the source of truth;
 * the chip is purely a control surface.
 *
 * a11y: rendered as a `radiogroup` so screen-reader users hear "1 of 4"
 * orientation, with arrow-key navigation between chips.
 */
export type AuditFilter = "all" | "deletions" | "edits" | "permissions";

export const AUDIT_FILTERS: AuditFilter[] = [
  "all",
  "deletions",
  "edits",
  "permissions",
];

type Labels = Record<AuditFilter, string>;

type FilterChipsProps = {
  value: AuditFilter;
  onChange: (next: AuditFilter) => void;
  labels: Labels;
  groupLabel: string;
};

export function FilterChips({
  value,
  onChange,
  labels,
  groupLabel,
}: FilterChipsProps) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next =
      e.key === "ArrowRight"
        ? (idx + 1) % AUDIT_FILTERS.length
        : (idx - 1 + AUDIT_FILTERS.length) % AUDIT_FILTERS.length;
    const nextFilter = AUDIT_FILTERS[next];
    if (!nextFilter) return;
    onChange(nextFilter);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      style={{
        display: "flex",
        gap: "var(--lg-sp-2)",
        padding: "var(--lg-sp-3) var(--lg-sp-4)",
        overflowX: "auto",
        borderBottom: "1px solid var(--lg-border)",
      }}
    >
      {AUDIT_FILTERS.map((filter, idx) => {
        const checked = value === filter;
        return (
          <button
            key={filter}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(filter)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              "inline-flex shrink-0 items-center rounded-[var(--lg-r-full)] border px-3 text-sm font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--lg-bg)]",
            )}
            style={{
              minHeight: 36,
              background: checked ? "var(--lg-accent)" : "transparent",
              color: checked ? "var(--lg-accent-fg)" : "var(--lg-fg)",
              borderColor: checked ? "transparent" : "var(--lg-border)",
            }}
          >
            {labels[filter]}
          </button>
        );
      })}
    </div>
  );
}
