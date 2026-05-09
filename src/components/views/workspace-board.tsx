"use client";

/**
 * Workspace-wide Kanban surface — same `KanbanBoard` component as the
 * per-list board, but the data source aggregates every list the user
 * can read inside the active workspace and the cards render a list
 * badge so the user knows where each card lives.
 *
 * Filters: priority chips + assignee chips. Status filter is implicit
 * (the columns are status). Tags are not chip-filterable yet — Phase
 * 16+ will add a tag drawer once the tag picker stabilizes.
 *
 * Polling: 5s, same cadence as the per-list board.
 */
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { PRIORITY_META } from "@/components/lists/item-attributes-meta";
import type { ItemPriority } from "@/components/lists/item-filters";
import { Button } from "@/components/ui/button";
import { KanbanBoard, type KanbanItem } from "@/components/views/kanban-board";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type WireItem = Omit<KanbanItem, "completedAt" | "createdAt" | "updatedAt"> & {
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  list: { id: string; name: string; emoji: string | null };
};

type Member = {
  memberId: string;
  userId: string;
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
    telegramPhotoUrl: string | null;
  };
};

type Props = {
  workspaceId: string;
  initialItems: KanbanItem[];
  initialMembers: Member[];
  canWrite: boolean;
};

const cacheKey = (workspaceId: string) =>
  ["items", "workspace", workspaceId] as const;

export function WorkspaceBoard({
  workspaceId,
  initialItems,
  initialMembers,
  canWrite,
}: Props) {
  const [priority, setPriority] = React.useState<ItemPriority | null>(null);
  const [assignee, setAssignee] = React.useState<string | "unassigned" | null>(
    null,
  );

  const itemsQuery = useQuery({
    queryKey: cacheKey(workspaceId),
    queryFn: async () => {
      const data = await apiFetch<{ ok: boolean; items: WireItem[] }>(
        `/api/views/board?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      // Re-hydrate Date columns so the board's "last 30 days" filter
      // (`completedAt.getTime()`) keeps working.
      return data.items.map(
        (it): KanbanItem => ({
          ...(it as unknown as KanbanItem),
          completedAt: it.completedAt ? new Date(it.completedAt) : null,
          createdAt: new Date(it.createdAt),
          updatedAt: new Date(it.updatedAt),
          deadlineAt: it.deadlineAt ? new Date(it.deadlineAt) : null,
          archivedAt: it.archivedAt ? new Date(it.archivedAt) : null,
          pinnedAt: it.pinnedAt ? new Date(it.pinnedAt) : null,
        }),
      );
    },
    initialData: initialItems,
    refetchInterval: 5000,
  });

  const membersQuery = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: async () => {
      const data = await apiFetch<{
        ok: boolean;
        data: { members: Member[] };
      }>(`/api/workspaces/${workspaceId}/members`);
      return data.data.members;
    },
    initialData: initialMembers,
  });

  // Stable references via useMemo so downstream useMemo deps don't
  // re-fire on every render when react-query returns the same array.
  const items = React.useMemo(
    () => itemsQuery.data ?? [],
    [itemsQuery.data],
  );
  const members = React.useMemo(
    () => membersQuery.data ?? [],
    [membersQuery.data],
  );

  // Filter set: only members that actually have items assigned to them
  // appear as chips. Avoids cluttering the bar with strangers.
  const assignedUserIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const it of items) {
      if (it.assigneeId) ids.add(it.assigneeId);
    }
    return ids;
  }, [items]);

  const visibleMembers = React.useMemo(
    () => members.filter((m: Member) => assignedUserIds.has(m.userId)),
    [members, assignedUserIds],
  );

  const filtered = React.useMemo(() => {
    return items.filter((it) => {
      if (priority !== null && it.priority !== priority) return false;
      if (assignee === "unassigned" && it.assigneeId !== null) return false;
      if (
        assignee &&
        assignee !== "unassigned" &&
        it.assigneeId !== assignee
      ) {
        return false;
      }
      return true;
    });
  }, [items, priority, assignee]);

  const hasFilter = priority !== null || assignee !== null;

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-[var(--lb-border)]"
        role="toolbar"
        aria-label="Pano filtreleri"
      >
        <span className="text-xs text-[var(--lb-muted-fg)] mr-1">Öncelik:</span>
        {PRIORITY_META.map((p) => (
          <FilterChip
            key={p.value}
            active={priority === p.value}
            onClick={() =>
              setPriority((cur) => (cur === p.value ? null : p.value))
            }
            label={p.label}
            color={p.color}
          />
        ))}
        {visibleMembers.length > 0 && (
          <>
            <span className="text-xs text-[var(--lb-muted-fg)] ml-2 mr-1">
              Atanan:
            </span>
            <FilterChip
              active={assignee === "unassigned"}
              onClick={() =>
                setAssignee((cur: typeof assignee) =>
                  cur === "unassigned" ? null : "unassigned",
                )
              }
              label="— yok —"
            />
            {visibleMembers.map((m: Member) => {
              const label =
                m.user.telegramFirstName ??
                m.user.telegramUsername ??
                m.userId.slice(0, 6);
              return (
                <FilterChip
                  key={m.userId}
                  active={assignee === m.userId}
                  onClick={() =>
                    setAssignee((cur) =>
                      cur === m.userId ? null : m.userId,
                    )
                  }
                  label={label}
                />
              );
            })}
          </>
        )}
        {hasFilter && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setPriority(null);
              setAssignee(null);
            }}
            className="h-6 px-2 py-0 text-[10px] ml-auto"
          >
            Temizle
          </Button>
        )}
      </div>

      <KanbanBoard
        cacheKey={cacheKey(workspaceId)}
        items={filtered}
        canWrite={canWrite}
        showListBadge
      />
    </>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "border-[var(--lb-accent)] bg-[var(--lb-accent)] text-[var(--lb-accent-fg,white)]"
          : "border-[var(--lb-border)] bg-[var(--lb-card)] text-[var(--lb-fg)] hover:border-[var(--lb-accent)]",
      )}
      aria-pressed={active}
    >
      {color && (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
          }}
        />
      )}
      {label}
    </button>
  );
}
