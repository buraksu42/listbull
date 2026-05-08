"use client";

import * as React from "react";

import {
  MetaInline,
  PRIORITY_META,
  STATUS_META,
} from "@/components/lists/item-attributes-meta";

export type ItemStatus = "open" | "in_progress" | "blocked" | "done";
export type ItemPriority = "low" | "normal" | "high";

export type ItemFilters = {
  /** Empty Set = no filter (show all). Default below selects 'open' so
   *  the list matches the pre-Phase 7 default behavior. */
  status: Set<ItemStatus>;
  priority: Set<ItemPriority>;
  /** Empty array = no filter. Tags are workspace vocabulary. */
  tags: Set<string>;
};

export const DEFAULT_FILTERS: ItemFilters = {
  // Hide done items by default, mirror legacy is_done=false behavior.
  status: new Set(["open", "in_progress", "blocked"]),
  priority: new Set(),
  tags: new Set(),
};

// Status + priority labels/icons live in `item-attributes-meta.tsx`.
// We map directly off STATUS_META / PRIORITY_META to avoid drift.

type Props = {
  filters: ItemFilters;
  onChange: (next: ItemFilters) => void;
  /** Workspace tag vocabulary for the chip row. Loaded from
   *  /api/workspaces/[id]/tags by the parent. */
  availableTags: string[];
};

/**
 * Filter chip strip for item lists. Multi-select per dimension;
 * tap a chip to toggle. Default shows non-done items (matches the
 * legacy is_done=false default).
 */
export function ItemFilters({ filters, onChange, availableTags }: Props) {
  function toggle<T extends string>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  const hasNonDefault =
    filters.priority.size > 0 ||
    filters.tags.size > 0 ||
    filters.status.size !== DEFAULT_FILTERS.status.size ||
    [...filters.status].some((s) => !DEFAULT_FILTERS.status.has(s));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--lb-sp-2)",
        padding: "var(--lb-sp-3) var(--lb-sp-4)",
        borderBottom: "1px solid var(--lb-border)",
        background: "var(--lb-bg)",
      }}
    >
      <ChipGroup label="Durum">
        {STATUS_META.map((m) => (
          <Chip
            key={m.value}
            active={filters.status.has(m.value)}
            onClick={() =>
              onChange({
                ...filters,
                status: toggle(filters.status, m.value),
              })
            }
          >
            <MetaInline Icon={m.Icon} label={m.label} color={m.color} />
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Öncelik">
        {PRIORITY_META.map((m) => (
          <Chip
            key={m.value}
            active={filters.priority.has(m.value)}
            onClick={() =>
              onChange({
                ...filters,
                priority: toggle(filters.priority, m.value),
              })
            }
          >
            <MetaInline Icon={m.Icon} label={m.label} color={m.color} />
          </Chip>
        ))}
      </ChipGroup>

      {availableTags.length > 0 && (
        <ChipGroup label="Etiket">
          {availableTags.map((tag) => (
            <Chip
              key={tag}
              active={filters.tags.has(tag)}
              onClick={() =>
                onChange({
                  ...filters,
                  tags: toggle(filters.tags, tag),
                })
              }
            >
              #{tag}
            </Chip>
          ))}
        </ChipGroup>
      )}

      {hasNonDefault && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            color: "var(--lb-muted-fg)",
            border: "none",
            padding: 0,
            fontSize: "var(--lb-fs-xs)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Filtreleri sıfırla
        </button>
      )}
    </div>
  );
}

function ChipGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--lb-sp-2)",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          color: "var(--lb-muted-fg)",
          fontSize: "var(--lb-fs-xs)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          minWidth: 56,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? "var(--lb-accent)" : "var(--lb-card)",
        color: active ? "var(--lb-accent-fg)" : "var(--lb-fg)",
        border: `1px solid ${active ? "var(--lb-accent)" : "var(--lb-border)"}`,
        borderRadius: "999px",
        padding: "2px 10px",
        fontSize: "var(--lb-fs-xs)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Apply the active filters to an items array. Pure helper so item-list.tsx
 * can call it with optimistically-mutated state.
 */
export function applyItemFilters<
  T extends {
    status: string;
    priority: string;
    tags: string[];
  },
>(items: T[], filters: ItemFilters): T[] {
  return items.filter((item) => {
    if (
      filters.status.size > 0 &&
      !filters.status.has(item.status as ItemStatus)
    ) {
      return false;
    }
    if (
      filters.priority.size > 0 &&
      !filters.priority.has(item.priority as ItemPriority)
    ) {
      return false;
    }
    if (filters.tags.size > 0) {
      const intersect = item.tags.some((t) => filters.tags.has(t));
      if (!intersect) return false;
    }
    return true;
  });
}
