/**
 * `activity_log` read helpers.
 *
 * The B1 feed uses one SQL JOIN to attach actor user info — see
 * `docs/architecture-pass-phase-3.md` § activity-feed read pattern.
 * Drives off the existing `activity_list_recent_idx` (`(list_id,
 * created_at desc)`) for cursor pagination.
 */
import { and, desc, eq, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, users } from "@/lib/db/schema";
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
