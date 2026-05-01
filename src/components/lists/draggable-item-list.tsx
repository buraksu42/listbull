"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import * as React from "react";

import { ItemRow } from "@/components/lists/item-row";
import type { Item } from "@/lib/types";

/**
 * Sortable list wrapper. Long-press on touch (PointerSensor activation
 * distance) starts a drag; on desktop, the drag handle is keyboard-
 * accessible via tab + space (KeyboardSensor + sortable coordinates).
 *
 * Position math is sparse: we re-number using the midpoint of the
 * neighbour positions (gaps of ~1024 between items at insert time so
 * subsequent reorders rarely cascade). The parent <ItemList /> persists
 * `position` for the moved item only; other rows keep their numbers.
 */
export function DraggableItemList({
  items,
  onToggle,
  onEdit,
  onDelete,
  onReorder,
  pendingIds,
}: {
  items: Item[];
  onToggle: (id: string, next: boolean) => void;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
  onReorder: (id: string, newPosition: number, optimistic: Item[]) => void;
  pendingIds: Set<string>;
}) {
  const sensors = useSensors(
    // 8px activation distance keeps tap-to-toggle responsive while still
    // letting a deliberate drag start; 250ms delay variant on PointerSensor
    // would be the long-press model but is harsher on desktop UX.
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((it) => it.id === active.id);
    const newIndex = items.findIndex((it) => it.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    const moved = reordered[newIndex];
    if (!moved) return;

    const newPosition = computeSparsePosition(reordered, newIndex);
    // Reflect into the cache via the parent's optimistic write so polling
    // doesn't snap items back before the PATCH lands.
    const optimistic = reordered.map((it, idx) =>
      idx === newIndex ? { ...it, position: newPosition } : it,
    );
    onReorder(moved.id, newPosition, optimistic);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((it) => it.id)}
        strategy={verticalListSortingStrategy}
      >
        <div role="list" aria-label="Items">
          {items.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              onToggle={(next) => onToggle(item.id, next)}
              onEdit={() => onEdit(item)}
              onDelete={() => onDelete(item)}
              pending={pendingIds.has(item.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({
  item,
  onToggle,
  onEdit,
  onDelete,
  pending,
}: {
  item: Item;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: isDragging ? "var(--lg-card)" : undefined,
  };

  const dragHandle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={`Reorder ${item.text}`}
      className="flex h-11 w-7 cursor-grab items-center justify-center rounded-[var(--lg-r-sm)] text-[var(--lg-muted-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--lg-bg)] active:cursor-grabbing"
      style={{ touchAction: "none" }}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" aria-hidden />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style}>
      <ItemRow
        item={item}
        onToggle={onToggle}
        onEdit={onEdit}
        onDelete={onDelete}
        pending={pending}
        dragHandle={dragHandle}
      />
    </div>
  );
}

/**
 * Compute a sparse position number for `items[index]` such that it sits
 * between its new neighbours by mid-point. Gaps of ~1024 mean a single
 * reorder rarely needs to renumber other rows; eventual collisions
 * (positions identical due to repeated mid-pointing) require a
 * server-side compaction job, deferred to Phase 4.
 */
function computeSparsePosition(items: Item[], index: number): number {
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
