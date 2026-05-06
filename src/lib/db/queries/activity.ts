/**
 * `activity_log` read helpers.
 *
 * The B1 feed uses one SQL JOIN to attach actor user info — see
 * `docs/architecture-pass-phase-3.md` § activity-feed read pattern.
 * Drives off the existing `activity_list_recent_idx` (`(list_id,
 * created_at desc)`) for cursor pagination.
 */
import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, lists, users } from "@/lib/db/schema";
import type { ActivityAction, ActivityEntityType, ActivityFeedRow } from "@/lib/types";

/**
 * Paginated activity feed for one list. `limit` is clamped to 1..200
 * by the route handler before calling this; we accept the raw value
 * defensively.
 */
export async function getActivityFeed(
  listId: string,
  limit: number,
  beforeIso?: string | null,
): Promise<ActivityFeedRow[]> {
  // Phase 4 · P2-4: clamp to 100 to match the route handler + Phase 3
  // contract (Phase 3 review noted the 200 ceiling as code/contract drift).
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 50));
  const conds = [eq(activityLog.listId, listId)];
  if (beforeIso) {
    const beforeDate = new Date(beforeIso);
    if (!Number.isNaN(beforeDate.getTime())) {
      conds.push(lt(activityLog.createdAt, beforeDate));
    }
  }

  const rows = await db
    .select({
      id: activityLog.id,
      listId: activityLog.listId,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      action: activityLog.action,
      actorId: activityLog.actorId,
      actorFirstName: users.telegramFirstName,
      actorUsername: users.telegramUsername,
      actorPhotoUrl: users.telegramPhotoUrl,
      payloadBefore: activityLog.payloadBefore,
      payloadAfter: activityLog.payloadAfter,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .innerJoin(users, eq(users.id, activityLog.actorId))
    .where(and(...conds))
    .orderBy(desc(activityLog.createdAt))
    .limit(safeLimit);

  return rows.map((r) => ({
    id: r.id,
    listId: r.listId ?? listId,
    entityType: r.entityType as ActivityEntityType,
    entityId: r.entityId,
    action: r.action as ActivityAction,
    actorId: r.actorId,
    actorFirstName: r.actorFirstName,
    actorUsername: r.actorUsername,
    actorPhotoUrl: r.actorPhotoUrl,
    payloadBefore: r.payloadBefore,
    payloadAfter: r.payloadAfter,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Workspace-scoped activity feed (Phase 6.5). Powers the workspace
 * admin dashboard timeline. Includes:
 *   - per-list events (any list in the workspace)
 *   - workspace-shell events (entity_type='workspace', entity_id =
 *     workspace_id; null list_id)
 *
 * Backfill query: LEFT JOIN through lists for the per-list events;
 * UNION-equivalent OR for the workspace-shell rows. Cursor pagination
 * via beforeIso.
 */
export async function getWorkspaceActivityFeed(
  workspaceId: string,
  limit: number,
  beforeIso?: string | null,
): Promise<ActivityFeedRow[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 50));

  const conds = [
    or(
      // Workspace-shell events: entity_type='workspace', entity_id = workspaceId.
      and(
        eq(activityLog.entityType, "workspace"),
        eq(activityLog.entityId, workspaceId),
      ),
      // Per-list events scoped to the workspace via the LEFT JOIN below.
      eq(lists.workspaceId, workspaceId),
    ),
  ];
  if (beforeIso) {
    const beforeDate = new Date(beforeIso);
    if (!Number.isNaN(beforeDate.getTime())) {
      conds.push(lt(activityLog.createdAt, beforeDate));
    }
  }

  const rows = await db
    .select({
      id: activityLog.id,
      listId: activityLog.listId,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      action: activityLog.action,
      actorId: activityLog.actorId,
      actorFirstName: users.telegramFirstName,
      actorUsername: users.telegramUsername,
      actorPhotoUrl: users.telegramPhotoUrl,
      payloadBefore: activityLog.payloadBefore,
      payloadAfter: activityLog.payloadAfter,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .innerJoin(users, eq(users.id, activityLog.actorId))
    .leftJoin(lists, eq(lists.id, activityLog.listId))
    .where(and(...conds))
    .orderBy(desc(activityLog.createdAt))
    .limit(safeLimit);

  // Reference-only: keep `sql` import live for future raw filters
  // (e.g. excluding low-signal events).
  void sql;

  return rows.map((r) => ({
    id: r.id,
    // For workspace-shell events list_id is null; surface "" so
    // ActivityFeedRow's string contract holds. Frontend ignores this
    // field on entityType='workspace' rows.
    listId: r.listId ?? "",
    entityType: r.entityType as ActivityEntityType,
    entityId: r.entityId,
    action: r.action as ActivityAction,
    actorId: r.actorId,
    actorFirstName: r.actorFirstName,
    actorUsername: r.actorUsername,
    actorPhotoUrl: r.actorPhotoUrl,
    payloadBefore: r.payloadBefore,
    payloadAfter: r.payloadAfter,
    createdAt: r.createdAt.toISOString(),
  }));
}
