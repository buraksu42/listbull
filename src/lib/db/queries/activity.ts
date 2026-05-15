/**
 * `activity_log` read helpers (Phase 17 chat-only).
 *
 * Activity is per-chat. Old workspace + list feeds dropped.
 */
import { and, desc, eq, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, users } from "@/lib/db/schema";
import type { ActivityAction, ActivityEntityType } from "@/lib/types";

export type ChatActivityFeedRow = {
  id: string;
  chatId: number | null;
  entityType: ActivityEntityType;
  entityId: string;
  action: ActivityAction;
  actorId: string;
  actorFirstName: string;
  actorUsername: string | null;
  actorPhotoUrl: string | null;
  payloadBefore: unknown;
  payloadAfter: unknown;
  createdAt: string;
};

/** Paginated activity feed for one chat. */
export async function getChatActivityFeed(
  chatId: number,
  limit: number,
  beforeIso?: string | null,
): Promise<ChatActivityFeedRow[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 50));
  const conds = [eq(activityLog.chatId, chatId)];
  if (beforeIso) {
    const beforeDate = new Date(beforeIso);
    if (!Number.isNaN(beforeDate.getTime())) {
      conds.push(lt(activityLog.createdAt, beforeDate));
    }
  }

  const rows = await db
    .select({
      id: activityLog.id,
      chatId: activityLog.chatId,
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
    chatId: r.chatId,
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
