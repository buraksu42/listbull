/**
 * Phase 15: read-side query helpers for cross-list "view" routes
 * (Today, Week, future Month / Calendar). Both the SSR shells and
 * the API routes consume these so the wire shape stays consistent
 * regardless of which surface called.
 */
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists } from "@/lib/db/schema";
import type { Item, List } from "@/lib/types";

export type WeekItemRow = Item & {
  list: Pick<List, "id" | "name" | "emoji">;
};

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
