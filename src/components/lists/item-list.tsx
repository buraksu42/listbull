"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import * as React from "react";

import { ChecklistBanner } from "@/components/lists/checklist-banner";
import { DraggableItemList } from "@/components/lists/draggable-item-list";
import { ItemDeleteConfirm } from "@/components/lists/item-delete-confirm";
import {
  ItemEditSheet,
  type ItemEditPatch,
} from "@/components/lists/item-edit-sheet";
import {
  applyItemFilters,
  DEFAULT_FILTERS,
  ItemFilters,
  type ItemFilters as ItemFiltersType,
} from "@/components/lists/item-filters";
import {
  membersById,
  membersKey,
  type MemberRow,
} from "@/components/lists/member-list";
import { EmptyState } from "@/components/shared/empty-state";
import { toast } from "@/components/ui/sonner";
import { apiDelete, ApiError, apiFetch, apiPatch } from "@/lib/api-client";
import type { Item } from "@/lib/types";
import type {
  DeleteItemResponse,
  PatchItemResponse,
} from "@/lib/validators/items";

/**
 * Client-side orchestrator for an item list. Owns:
 * - polling fetch via TanStack Query (5s in foreground, paused when hidden)
 * - optimistic toggle / edit / delete via TanStack mutate's onMutate-onError
 *   rollback pattern (cleaner than `useOptimistic` for multi-mutation flows)
 * - reorder dispatch (executed inside <DraggableItemList />, persisted here)
 *
 * `useOptimistic` was a contender; we chose TanStack mutate because we
 * already need the QueryClient cache for polling reconciliation, and
 * keeping a single source of truth for the items array avoids
 * useOptimistic's split-state confusion when the polling response races
 * against an in-flight mutation. The same cache invalidation step also
 * handles concurrent mutations (sharing list users editing simultaneously).
 *
 * Phase 3: also reads the members cache (populated by <MemberList /> on
 * the same screen) to feed assignee badges into <DraggableItemList />.
 * The members list is a small parallel query (5s polling, same as items)
 * so badges stay in sync when members are added/removed.
 */

type ItemsResponse = { items: Item[] };
type MembersResponse = { members: MemberRow[] };

const itemsKey = (listId: string) => ["items", listId] as const;

export function ItemList({
  listId,
  initialItems,
  initialMembers = [],
  isChecklist = false,
}: {
  listId: string;
  initialItems: Item[];
  /**
   * Phase 3: parent passes members fetched server-side so assignee
   * badges render on first paint without a client-side flash.
   */
  initialMembers?: MemberRow[];
  /**
   * Phase 16: when true, render the checklist banner (run history +
   * "Yeni run başlat" CTA) above the item list.
   */
  isChecklist?: boolean;
}) {
  const queryClient = useQueryClient();

  const itemsQuery = useQuery<Item[]>({
    queryKey: itemsKey(listId),
    queryFn: async () => {
      const data = await apiFetch<ItemsResponse>(
        `/api/lists/${listId}/items`,
      );
      return data.items;
    },
    initialData: initialItems,
  });

  const membersQuery = useQuery<MemberRow[]>({
    queryKey: membersKey(listId),
    queryFn: async () => {
      const data = await apiFetch<MembersResponse>(
        `/api/lists/${listId}/members`,
      );
      return data.members;
    },
    initialData: initialMembers,
  });

  const items = React.useMemo(
    () => itemsQuery.data ?? [],
    [itemsQuery.data],
  );
  const memberLookup = React.useMemo(
    () => membersById(membersQuery.data),
    [membersQuery.data],
  );

  // ─── Phase 7: filter chips ────────────────────────────────────────
  const [filters, setFilters] =
    React.useState<ItemFiltersType>(DEFAULT_FILTERS);

  // Available tag vocabulary derived from currently-loaded items —
  // saves an extra API call. Sorted alphabetically for stable order.
  const availableTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const t of it.tags ?? []) set.add(t);
    }
    return Array.from(set).sort();
  }, [items]);

  const filteredItems = React.useMemo(
    () => applyItemFilters(items, filters),
    [items, filters],
  );

  // ─── toggle (is_done) ───────────────────────────────────────────────
  const toggleMutation = useMutation<
    PatchItemResponse,
    ApiError,
    { id: string; isDone: boolean },
    { previous?: Item[] }
  >({
    mutationFn: async ({ id, isDone }) => {
      return apiPatch<PatchItemResponse>(`/api/items/${id}`, { isDone });
    },
    onMutate: async ({ id, isDone }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey(listId) });
      const previous = queryClient.getQueryData<Item[]>(itemsKey(listId));
      queryClient.setQueryData<Item[]>(itemsKey(listId), (current) =>
        (current ?? []).map((item) =>
          item.id === id ? { ...item, isDone } : item,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(itemsKey(listId), ctx.previous);
      }
      toast.error("Couldn't update — try again.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey(listId) });
    },
  });

  // ─── edit (text + due_at) ───────────────────────────────────────────
  const editMutation = useMutation<
    PatchItemResponse,
    ApiError,
    { id: string; patch: ItemEditPatch },
    { previous?: Item[] }
  >({
    mutationFn: async ({ id, patch }) => {
      return apiPatch<PatchItemResponse>(`/api/items/${id}`, patch);
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey(listId) });
      const previous = queryClient.getQueryData<Item[]>(itemsKey(listId));
      queryClient.setQueryData<Item[]>(itemsKey(listId), (current) =>
        (current ?? []).map((item) => {
          if (item.id !== id) return item;
          const next: Item = { ...item };
          if (patch.text !== undefined) next.text = patch.text;
          if (patch.description !== undefined) {
            next.description = patch.description;
          }
          if (patch.deadlineAt !== undefined) {
            next.deadlineAt = patch.deadlineAt
              ? new Date(patch.deadlineAt)
              : null;
          }
          if (patch.status !== undefined) next.status = patch.status;
          if (patch.priority !== undefined) next.priority = patch.priority;
          if (patch.tags !== undefined) next.tags = patch.tags;
          if (patch.pinned !== undefined) {
            next.pinnedAt = patch.pinned ? new Date() : null;
          }
          if (patch.taskRecurrenceRule !== undefined) {
            next.taskRecurrenceRule = patch.taskRecurrenceRule;
          }
          return next;
        }),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(itemsKey(listId), ctx.previous);
      }
      toast.error("Couldn't save changes — try again.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey(listId) });
    },
  });

  // ─── delete (soft-delete via DELETE) ────────────────────────────────
  const deleteMutation = useMutation<
    DeleteItemResponse,
    ApiError,
    { id: string },
    { previous?: Item[] }
  >({
    mutationFn: async ({ id }) => {
      return apiDelete<DeleteItemResponse>(`/api/items/${id}`);
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey(listId) });
      const previous = queryClient.getQueryData<Item[]>(itemsKey(listId));
      queryClient.setQueryData<Item[]>(itemsKey(listId), (current) =>
        (current ?? []).filter((item) => item.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(itemsKey(listId), ctx.previous);
      }
      toast.error("Couldn't delete — try again.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey(listId) });
    },
  });

  // ─── reorder (sparse positions) ─────────────────────────────────────
  const reorderMutation = useMutation<
    PatchItemResponse,
    ApiError,
    { id: string; position: number },
    { previous?: Item[] }
  >({
    mutationFn: async ({ id, position }) => {
      return apiPatch<PatchItemResponse>(`/api/items/${id}`, { position });
    },
    onMutate: async () => {
      // Optimistic state already applied by <DraggableItemList />; we
      // cancel polls and snapshot for rollback only.
      await queryClient.cancelQueries({ queryKey: itemsKey(listId) });
      const previous = queryClient.getQueryData<Item[]>(itemsKey(listId));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(itemsKey(listId), ctx.previous);
      }
      toast.error("Couldn't reorder — try again.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey(listId) });
    },
  });

  // ─── ui state for sheets ────────────────────────────────────────────
  const [editingItem, setEditingItem] = React.useState<Item | null>(null);
  const [deletingItem, setDeletingItem] = React.useState<Item | null>(null);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-6 w-6" aria-hidden />}
        title="Empty list"
        description="Send a message to the bot to add an item."
      />
    );
  }

  return (
    <>
      {isChecklist && <ChecklistBanner listId={listId} />}
      {!isChecklist && (
        <ItemFilters
          filters={filters}
          onChange={setFilters}
          availableTags={availableTags}
        />
      )}
      {filteredItems.length === 0 && (
        <p
          style={{
            padding: "var(--lb-sp-4)",
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-sm)",
            margin: 0,
            textAlign: "center",
          }}
        >
          Bu filtreyle eşleşen item yok.
        </p>
      )}
      <DraggableItemList
        items={filteredItems}
        onToggle={(id, next) => toggleMutation.mutate({ id, isDone: next })}
        onEdit={(item) => setEditingItem(item)}
        onDelete={(item) => setDeletingItem(item)}
        onTogglePin={(id, next) =>
          editMutation.mutate({ id, patch: { pinned: next } })
        }
        onReorder={(id, newPosition, optimisticItems) => {
          // Apply optimistic reorder to the cache so the UI doesn't snap back
          // before the request lands.
          queryClient.setQueryData<Item[]>(itemsKey(listId), optimisticItems);
          reorderMutation.mutate({ id, position: newPosition });
        }}
        pendingIds={pendingIdsFrom(
          toggleMutation.variables?.id,
          editMutation.variables?.id,
          deleteMutation.variables?.id,
        )}
        membersByUserId={memberLookup}
        compact={isChecklist}
      />

      <ItemEditSheet
        item={editingItem}
        open={editingItem !== null}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
        onSave={async (patch) => {
          if (!editingItem) return;
          await editMutation.mutateAsync({ id: editingItem.id, patch });
        }}
      />

      <ItemDeleteConfirm
        item={deletingItem}
        open={deletingItem !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingItem(null);
        }}
        onConfirm={async () => {
          if (!deletingItem) return;
          await deleteMutation.mutateAsync({ id: deletingItem.id });
        }}
        pending={deleteMutation.isPending}
      />
    </>
  );
}

function pendingIdsFrom(...ids: Array<string | undefined>): Set<string> {
  const set = new Set<string>();
  for (const id of ids) {
    if (id) set.add(id);
  }
  return set;
}
