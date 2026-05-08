"use client";

import {
  CheckCircle2,
  Equal,
  Flame,
  Hourglass,
  type LucideIcon,
  Play,
  Snowflake,
  Square,
} from "lucide-react";
import * as React from "react";

import type {
  ItemPriority,
  ItemStatus,
} from "@/components/lists/item-filters";

/**
 * Single source of truth for status + priority chip glyphs. Reused by:
 *   - item-filters.tsx        (filter chip strip)
 *   - item-edit-sheet.tsx     (per-item edit pickers)
 *   - activity-sentence.tsx   (potentially, if we visualize state changes)
 *
 * Keep labels in TR (matches existing Mini App copy); the bot-side
 * status emoji prefix lives in the system prompt (system.v4.ts) and is
 * a separate surface — they don't have to match glyph-for-glyph as
 * long as the semantics line up.
 */
export type StatusMeta = {
  value: ItemStatus;
  label: string;
  Icon: LucideIcon;
  /** CSS color token. Falls back to currentColor when omitted. */
  color?: string;
};

export type PriorityMeta = {
  value: ItemPriority;
  label: string;
  Icon: LucideIcon;
  color?: string;
};

export const STATUS_META: StatusMeta[] = [
  { value: "open", label: "Yapılacak", Icon: Square },
  { value: "in_progress", label: "Yapılıyor", Icon: Play, color: "var(--lb-accent)" },
  { value: "blocked", label: "Bekliyor", Icon: Hourglass, color: "var(--lb-muted-fg)" },
  { value: "done", label: "Tamamlandı", Icon: CheckCircle2, color: "var(--lb-accent)" },
];

export const PRIORITY_META: PriorityMeta[] = [
  { value: "high", label: "Yüksek", Icon: Flame, color: "var(--lb-destructive)" },
  { value: "normal", label: "Normal", Icon: Equal },
  { value: "low", label: "Düşük", Icon: Snowflake, color: "var(--lb-muted-fg)" },
];

export function statusMeta(value: ItemStatus): StatusMeta {
  return STATUS_META.find((m) => m.value === value) ?? STATUS_META[0]!;
}

export function priorityMeta(value: ItemPriority): PriorityMeta {
  return PRIORITY_META.find((m) => m.value === value) ?? PRIORITY_META[1]!;
}

/**
 * Inline icon + label, suitable for a chip body. Icon renders at 14px,
 * inherits color unless `meta.color` is set.
 */
export function MetaInline({
  Icon,
  label,
  color,
}: {
  Icon: LucideIcon;
  label: string;
  color?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: color ?? "currentColor",
      }}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
