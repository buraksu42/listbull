import type { Item } from "@/lib/types";

/**
 * Compute a sparse position number for `items[index]` such that it
 * sits between its new neighbours by mid-point.
 *
 * Gaps of ~1024 mean a single reorder rarely needs to renumber other
 * rows; eventual collisions (positions identical due to repeated
 * mid-pointing) require a server-side compaction job, deferred.
 *
 * Shared between:
 *   - DraggableItemList (single-list reorder, Phase 1+)
 *   - KanbanBoard (cross-status reorder, Phase 16 Kanban)
 */
export function computeSparsePosition(
  items: Pick<Item, "position">[],
  index: number,
): number {
  const before = index > 0 ? items[index - 1] : undefined;
  const after = index < items.length - 1 ? items[index + 1] : undefined;
  const beforePos = before?.position;
  const afterPos = after?.position;

  if (beforePos !== undefined && afterPos !== undefined) {
    return Math.floor((beforePos + afterPos) / 2);
  }
  if (beforePos !== undefined) {
    return beforePos + 1024;
  }
  if (afterPos !== undefined) {
    return Math.max(0, afterPos - 1024);
  }
  return 0;
}
