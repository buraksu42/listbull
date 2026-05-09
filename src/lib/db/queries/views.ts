/**
 * Phase 15: read-side query helpers for cross-list "view" routes
 * (Today, Week, future Month / Calendar). Both the SSR shells and
 * the API routes consume these so the wire shape stays consistent
 * regardless of which surface called.
 */
import { and, asc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists } from "@/lib/db/schema";
import type { Item, List } from "@/lib/types";

export type WeekItemRow = Item & {
  list: Pick<List, "id" | "name" | "emoji">;
};

/** Workspace-wide Kanban row shape — same `Item` + list pointer. */
export type WorkspaceBoardItemRow = WeekItemRow;

/**
 * Items the user can see (any list role) within a workspace whose
 * `deadline_at` falls in `[from, to)`. Archived rows are excluded.
 * Sorted by deadline ascending so calendar buckets read top-to-
 * bottom in temporal order without client-side resorting.
 */
export async function listItemsByDeadlineRange(args: {
  userId: string;
  workspaceId: string;
  from: Date;
  to: Date;
}): Promise<WeekItemRow[]> {
  const rows = await db
    .select({
      item: items,
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, args.userId),
        eq(lists.workspaceId, args.workspaceId),
        isNull(lists.archivedAt),
        isNull(items.archivedAt),
        gte(items.deadlineAt, args.from),
        lte(items.deadlineAt, args.to),
      ),
    )
    .orderBy(asc(items.deadlineAt));

  return rows.map((r) => ({
    ...r.item,
    list: { id: r.listId, name: r.listName, emoji: r.listEmoji },
  }));
}

/**
 * Items for the workspace-wide Kanban board — every list the user is
 * a member of inside the active workspace. Excludes archived items
 * and lists. Done-column items older than 30 days are also dropped
 * server-side so the wire payload stays bounded; the client toggle
 * for "show all done" then re-fetches without that filter via the
 * `?includeAllDone=1` query param.
 *
 * Inv-2: workspace = list-membership-derived. The `listMembers` join
 * is what enforces visibility — a workspace_members row alone is not
 * enough to see a list's items.
 */
export async function listItemsForWorkspaceBoard(args: {
  userId: string;
  workspaceId: string;
  includeAllDone?: boolean;
}): Promise<WorkspaceBoardItemRow[]> {
  const horizon = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const doneFilter = args.includeAllDone
    ? sql`true`
    : or(
        ne(items.status, "done"),
        gte(items.completedAt, horizon),
      );

  const rows = await db
    .select({
      item: items,
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, args.userId),
        eq(lists.workspaceId, args.workspaceId),
        isNull(lists.archivedAt),
        isNull(items.archivedAt),
        doneFilter,
      ),
    )
    .orderBy(asc(items.position));

  return rows.map((r) => ({
    ...r.item,
    list: { id: r.listId, name: r.listName, emoji: r.listEmoji },
  }));
}

// Reference imports kept live for callers that may add range filters.
void lte;
