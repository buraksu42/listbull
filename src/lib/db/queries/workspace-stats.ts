/**
 * Workspace usage stats for the admin dashboard (Phase 6).
 *
 * One round-trip per stat surface; no derived/cached numbers (read
 * volume is low — admins peek occasionally, not every request).
 */
import { and, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  items,
  lists,
  workspaceMembers,
} from "@/lib/db/schema";

export type WorkspaceStats = {
  memberCount: number;
  listCount: number;
  itemCount: number;
  openItemCount: number;
  doneItemCount: number;
  activityLast30d: number;
};

export async function getWorkspaceStats(
  workspaceId: string,
): Promise<WorkspaceStats> {
  const [memberRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  const [listRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lists)
    .where(
      and(eq(lists.workspaceId, workspaceId), isNull(lists.archivedAt)),
    );

  const [itemRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${items.isDone} = false)::int`,
      done: sql<number>`count(*) filter (where ${items.isDone} = true)::int`,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .where(
      and(
        eq(lists.workspaceId, workspaceId),
        isNull(items.archivedAt),
      ),
    );

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [activityRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activityLog)
    .innerJoin(lists, eq(lists.id, activityLog.listId))
    .where(
      and(
        eq(lists.workspaceId, workspaceId),
        gte(activityLog.createdAt, cutoff),
      ),
    );

  return {
    memberCount: memberRow?.count ?? 0,
    listCount: listRow?.count ?? 0,
    itemCount: itemRow?.total ?? 0,
    openItemCount: itemRow?.open ?? 0,
    doneItemCount: itemRow?.done ?? 0,
    activityLast30d: activityRow?.count ?? 0,
  };
}
