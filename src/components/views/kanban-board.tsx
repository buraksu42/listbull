"use client";

/**
 * Phase 16 (Kanban view): 4-column board over `items.status`.
 *
 *   - Drag a card within its column → status unchanged, position
 *     re-numbered via `computeSparsePosition`.
 *   - Drag a card across columns → both status AND position update.
 *     We round-trip both via the existing PATCH /api/items/[id]
 *     route (which delegates to executeUpdateItem + executeSetItemAttributes).
 *
 * Cross-container DnD uses dnd-kit's "Multiple Containers" pattern:
 * each column is its own SortableContext sharing one DndContext;
 * `over.id` carries either an item id (drop in middle of list) or a
 * column id (drop in empty space below cards) — we resolve both.
 *
 * Permission model: viewers can't drag — sensors return early when
 * `canWrite === false`. Tap-to-edit / tap-to-toggle stays available.
 *
 * Done filter: by default the "Tamamlandı" column shows only items
 * completed in the last 30 days. A toggle expands to all done items.
 */
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { GripVertical } from "lucide-react";

import {
  ItemEditSheet,
  type ItemEditPatch,
} from "@/components/lists/item-edit-sheet";
import { STATUS_META } from "@/components/lists/item-attributes-meta";
import { Button } from "@/components/ui/button";
import { apiPatch } from "@/lib/api-client";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import { computeSparsePosition } from "@/lib/utils/sparse-position";

const STATUSES = ["open", "in_progress", "blocked", "done"] as const;
type Status = (typeof STATUSES)[number];

const DONE_HISTORY_DAYS = 30;

/**
 * `Item` augmented with optional list info. The workspace-wide variant
 * passes the list metadata so cards can render a list badge; the
 * per-list variant omits it (badge hidden).
 */
export type KanbanItem = Item & {
  list?: { id: string; name: string; emoji: string | null };
};

type Props = {
  /** React Query cache key — distinct per surface so cache invalidations
   * don't bleed across the per-list and workspace-wide boards. */
  cacheKey: readonly unknown[];
  items: KanbanItem[];
  canWrite: boolean;
  /** Show "📋 List name" badge on each card (workspace board). */
  showListBadge?: boolean;
};

export function KanbanBoard({
  cacheKey,
  items,
  canWrite,
  showListBadge = false,
}: Props) {
  const qc = useQueryClient();
  const [showAllDone, setShowAllDone] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<KanbanItem | null>(null);

  const sensors = useSensors(
    // Mouse + Touch split (PointerSensor was unreliable inside Telegram
    // WebApp — long-press alone wasn't kicking off drag because the
    // WebApp scroll handler intercepts pointer events first).
    //
    // The drag-handle pattern (only the grip icon carries listeners,
    // not the whole card) lets us drop activation friction:
    //   - MouseSensor: 4px distance, fires immediately on a real click
    //   - TouchSensor: 100ms delay, 5px tolerance, prevents the
    //     accidental "I tapped a card" → drag scenario
    // The card body stays scrollable; only the handle is `touch-action:
    // none`, so vertical column scroll works as expected.
    useSensor(MouseSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 100, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Bucket items by status. "Done" column applies the rolling window
  // unless the user expanded it — keeps the column from growing into
  // a graveyard.
  const buckets = React.useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- 1-frame staleness is fine for a "last 30 days" window; React re-renders on items change anyway.
    const horizon = Date.now() - DONE_HISTORY_DAYS * 24 * 60 * 60 * 1000;
    const map = new Map<Status, KanbanItem[]>();
    for (const s of STATUSES) map.set(s, []);
    for (const it of items) {
      const status = (it.status as Status) ?? "open";
      if (status === "done" && !showAllDone) {
        const completedAt = it.completedAt ? it.completedAt.getTime() : 0;
        if (completedAt < horizon) continue;
      }
      const list = map.get(status);
      if (list) list.push(it);
    }
    // Sort each bucket by position ascending.
    for (const [, list] of map) {
      list.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [items, showAllDone]);

  const moveMutation = useMutation({
    mutationFn: async (vars: {
      id: string;
      status?: Status;
      position?: number;
    }) => {
      const patch: Record<string, unknown> = {};
      if (vars.status !== undefined) patch.status = vars.status;
      if (vars.position !== undefined) patch.position = vars.position;
      return apiPatch(`/api/items/${vars.id}`, patch);
    },
    onError: () => {
      // Optimistic UI rolled back via items invalidate — no manual
      // restore needed because the parent list polls every 5s.
      qc.invalidateQueries({ queryKey: cacheKey });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: cacheKey });
    },
  });

  const findContainer = React.useCallback(
    (id: string): Status | null => {
      for (const [status, list] of buckets) {
        if (list.some((it) => it.id === id)) return status;
      }
      // Drop zone might be the column id itself.
      if ((STATUSES as readonly string[]).includes(id)) {
        return id as Status;
      }
      return null;
    },
    [buckets],
  );

  // Snapshot the source status + bucket on drag start so dragEnd can
  // compute the cross-column move correctly even after dragOver
  // mutates the optimistic cache. Without this snapshot, `findContainer`
  // in dragEnd would return the OPTIMISTIC target status (because the
  // cache moved the card mid-drag), and the handler would mistake a
  // cross-column drop for a same-column reorder — status never gets
  // written, server snaps card back on next poll.
  const dragStartRef = React.useRef<{
    id: string;
    status: Status;
    item: KanbanItem;
  } | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    if (!canWrite) return;
    const activeId = String(event.active.id);
    const status = findContainer(activeId);
    if (!status) return;
    const list = buckets.get(status) ?? [];
    const item = list.find((it) => it.id === activeId);
    if (!item) return;
    dragStartRef.current = { id: activeId, status, item };
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!canWrite) return;
    const { active, over } = event;
    if (!over) return;
    const fromStatus = findContainer(String(active.id));
    const toStatus = findContainer(String(over.id));
    if (!fromStatus || !toStatus) return;
    if (fromStatus === toStatus) return;
    // Optimistic: move the card across columns in the cache so the
    // ghost lands in the right column visually.
    qc.setQueryData<KanbanItem[]>(cacheKey, (current) => {
      if (!current) return current;
      return current.map((it) =>
        it.id === active.id ? { ...it, status: toStatus } : it,
      );
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!canWrite) return;
    const { active, over } = event;
    const snapshot = dragStartRef.current;
    dragStartRef.current = null;
    if (!over || !snapshot) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Source status comes from drag-start snapshot (resilient against
    // the optimistic dragOver mutation). Target status comes from
    // current cache — that's already been moved by dragOver so it
    // reflects where the card is visually.
    const activeStatus = snapshot.status;
    const overStatus = findContainer(overId);
    if (!overStatus) return;

    const targetList = (buckets.get(overStatus) ?? []).slice();

    if (activeStatus === overStatus) {
      // Pure reorder within the source column.
      const movedIndex = targetList.findIndex((it) => it.id === activeId);
      const newIndex = targetList.findIndex((it) => it.id === overId);
      if (movedIndex === -1 || newIndex === -1 || newIndex === movedIndex) {
        qc.invalidateQueries({ queryKey: cacheKey });
        return;
      }
      const reordered = arrayMove(targetList, movedIndex, newIndex);
      const nextPos = computeSparsePosition(reordered, newIndex);
      moveMutation.mutate({ id: activeId, position: nextPos });
      return;
    }

    // Cross-column move. The card is already in `targetList` (dragOver
    // optimistic) so we only need to compute its final index.
    const overIdx = targetList.findIndex((it) => it.id === overId);
    const insertAt = overIdx >= 0 ? overIdx : targetList.length;
    // `targetList` may already contain the active card from dragOver;
    // strip it before recomputing position so arithmetic stays clean.
    const targetWithoutActive = targetList.filter((it) => it.id !== activeId);
    const reordered = [...targetWithoutActive];
    reordered.splice(insertAt, 0, { ...snapshot.item, status: overStatus });
    const nextPos = computeSparsePosition(reordered, insertAt);

    qc.setQueryData<KanbanItem[]>(cacheKey, (current) => {
      if (!current) return current;
      return current.map((it) =>
        it.id === activeId
          ? { ...it, status: overStatus, position: nextPos }
          : it,
      );
    });

    moveMutation.mutate({
      id: activeId,
      status: overStatus,
      position: nextPos,
    });
  };

  const handleDragCancel = () => {
    dragStartRef.current = null;
    qc.invalidateQueries({ queryKey: cacheKey });
  };

  // Multi-container collision detection: `closestCorners` fails on
  // empty columns under Telegram WebApp touch — the touch point falls
  // outside any item rect and corner distances aren't computed. We
  // try `pointerWithin` first (catches drops anywhere inside a column,
  // including the empty placeholder area), and fall back to
  // `rectIntersection` for edge-of-card drops near column boundaries.
  const collisionDetection = React.useCallback<CollisionDetection>(
    (args) => {
      const pointerHits = pointerWithin(args);
      if (pointerHits.length > 0) return pointerHits;
      return rectIntersection(args);
    },
    [],
  );

  return (
    <>
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className="flex gap-2 overflow-x-auto px-4 pb-4"
        style={{
          scrollSnapType: "x mandatory",
          // Fill the remaining viewport so columns can scroll their
          // own contents. Without this the outer page scrolls and
          // columns get clipped under footer affordances.
          minHeight: "calc(100dvh - 220px)",
        }}
      >
        {STATUSES.map((status) => {
          const meta = STATUS_META.find((m) => m.value === status);
          const list = buckets.get(status) ?? [];
          return (
            <Column
              key={status}
              status={status}
              label={meta?.label ?? status}
              accent={meta?.color ?? "var(--lb-muted-fg)"}
              items={list}
              canWrite={canWrite}
              showAllDone={showAllDone}
              onToggleShowAllDone={() => setShowAllDone((v) => !v)}
              showListBadge={showListBadge}
              onItemClick={(it) => setEditingItem(it)}
            />
          );
        })}
      </div>
    </DndContext>
    {editingItem && (
      <ItemEditSheet
        item={editingItem}
        open={true}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
        onSave={async (patch: ItemEditPatch) => {
          await apiPatch(`/api/items/${editingItem.id}`, patch);
          qc.invalidateQueries({ queryKey: cacheKey });
        }}
      />
    )}
    </>
  );
}

function Column({
  status,
  label,
  accent,
  items,
  canWrite,
  showAllDone,
  onToggleShowAllDone,
  showListBadge,
  onItemClick,
}: {
  status: Status;
  label: string;
  accent: string;
  items: KanbanItem[];
  canWrite: boolean;
  showAllDone: boolean;
  onToggleShowAllDone: () => void;
  showListBadge: boolean;
  onItemClick: (item: KanbanItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[280px] shrink-0 flex-col gap-2 rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-card)] p-2",
        isOver && "ring-2 ring-[var(--lb-accent)]",
      )}
      style={{
        scrollSnapAlign: "start",
        minHeight: 240,
      }}
    >
      <header className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: accent,
            }}
          />
          <span className="text-sm font-medium text-[var(--lb-fg)]">{label}</span>
          <span className="text-xs text-[var(--lb-muted-fg)]">{items.length}</span>
        </span>
        {status === "done" && (
          <Button
            type="button"
            variant="ghost"
            onClick={onToggleShowAllDone}
            className="h-6 px-2 py-0 text-[10px]"
          >
            {showAllDone ? "Son 30g" : "Tümü"}
          </Button>
        )}
      </header>
      <SortableContext
        items={items.map((it) => it.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-1.5">
          {items.length === 0 && (
            <li className="rounded-[var(--lb-r-sm)] border border-dashed border-[var(--lb-border)] p-3 text-center text-[11px] text-[var(--lb-muted-fg)]">
              Kart sürükleyin
            </li>
          )}
          {items.map((item) => (
            <KanbanCard
              key={item.id}
              item={item}
              canDrag={canWrite}
              showListBadge={showListBadge}
              onOpen={() => onItemClick(item)}
            />
          ))}
        </ul>
      </SortableContext>
    </div>
  );
}

function KanbanCard({
  item,
  canDrag,
  showListBadge,
  onOpen,
}: {
  item: KanbanItem;
  canDrag: boolean;
  showListBadge: boolean;
  onOpen: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !canDrag });

  const priorityColor =
    item.priority === "high"
      ? "var(--lb-destructive)"
      : item.priority === "low"
        ? "var(--lb-border)"
        : "var(--lb-muted-fg)";

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={cn(
        "rounded-[var(--lb-r-sm)] border border-[var(--lb-border)] bg-[var(--lb-bg)] p-2",
      )}
    >
      <div className="flex items-start gap-1.5">
        {canDrag && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label="Kartı sürükle"
            className="flex h-7 w-5 flex-shrink-0 items-center justify-center rounded-sm text-[var(--lb-muted-fg)] hover:bg-[var(--lb-card)] active:cursor-grabbing"
            style={{
              // Only the handle disables native gesture handling so
              // the rest of the column still scrolls under the user's
              // finger. Without this, dnd-kit's TouchSensor never sees
              // the touch — Telegram WebApp's scroll handler eats it.
              touchAction: "none",
              cursor: "grab",
            }}
          >
            <GripVertical width={14} height={14} aria-hidden />
          </button>
        )}
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            marginTop: 8,
            borderRadius: "50%",
            background: priorityColor,
            flexShrink: 0,
          }}
        />
        <button
          type="button"
          onClick={onOpen}
          className="line-clamp-3 flex-1 text-left text-sm text-[var(--lb-fg)] bg-transparent border-0 p-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)] rounded-sm"
          style={{
            textDecoration: item.isDone ? "line-through" : "none",
          }}
        >
          {item.text}
        </button>
      </div>
      {showListBadge && item.list && (
        <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--lb-muted-fg)]">
          <span aria-hidden>{item.list.emoji ?? "📋"}</span>
          <span className="max-w-[200px] truncate">{item.list.name}</span>
        </div>
      )}
      {(item.tags ?? []).length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {(item.tags ?? []).slice(0, 2).map((t) => (
            <span
              key={t}
              className="rounded-full bg-[var(--lb-card)] px-1.5 py-0.5 text-[9px] text-[var(--lb-muted-fg)]"
            >
              #{t}
            </span>
          ))}
          {(item.tags ?? []).length > 2 && (
            <span className="text-[9px] text-[var(--lb-muted-fg)]">
              +{(item.tags ?? []).length - 2}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
