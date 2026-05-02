/**
 * F1 — full data export bundle assembler (Phase 4).
 *
 * Inv-20: caller-only filter.
 *   - `lists`: lists where the caller is in `list_members` (any role).
 *   - `items`: items in those lists where `created_by = caller` OR
 *     `assignee_id = caller`. Other members' items never appear.
 *   - `activity`: rows where `actor_id = caller`.
 *   - `messages`: rows where `user_id = caller`.
 *
 * NEVER included:
 *   - encrypted OpenRouter API key (`openrouter_api_key_encrypted`)
 *   - session cookies
 *   - other users' messages, activity, or item rows
 *
 * Phase 4 contract: synchronous endpoint, completes in <5s for typical
 * users. The route handler streams `application/json` directly OR falls
 * back to a Hetzner Object Storage signed URL when `HETZNER_OBJECT_*`
 * env vars are configured (best-effort; the JSON response works either
 * way for self-host operators).
 */
import "server-only";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items, listMembers, lists, users } from "@/lib/db/schema";
import { getAllMessagesForUser } from "@/lib/db/queries/messages";
import { toItemSnapshot, toListSnapshot } from "@/lib/db/snapshots";
import type {
  ActivityAction,
  ActivityEntityType,
  ActivityFeedRow,
  ExportBundle,
  MessageRole,
} from "@/lib/types";

export async function generateExportBundle(
  userId: string,
): Promise<ExportBundle> {
  // ─── User profile ────────────────────────────────────────────────
  const [user] = await db
    .select({
      telegramId: users.telegramId,
      locale: users.locale,
      timezone: users.timezone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new Error("generateExportBundle: user not found");
  }

  // ─── Lists (any membership role) ─────────────────────────────────
  const listRows = await db
    .select({
      id: lists.id,
      name: lists.name,
      emoji: lists.emoji,
      ownerId: lists.ownerId,
      isInbox: lists.isInbox,
      archivedAt: lists.archivedAt,
      createdAt: lists.createdAt,
      updatedAt: lists.updatedAt,
    })
    .from(lists)
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(and(eq(listMembers.userId, userId), isNull(lists.archivedAt)));

  const exportLists = listRows.map(toListSnapshot);
  const listIds = exportLists.map((l) => l.id);

  // ─── Items (caller-only filter — created_by OR assignee_id) ──────
  const exportItems: ExportBundle["items"] = [];
  if (listIds.length > 0) {
    const itemRows = await db
      .select()
      .from(items)
      .where(
        and(
          inArray(items.listId, listIds),
          or(eq(items.createdBy, userId), eq(items.assigneeId, userId)),
        ),
      );
    for (const r of itemRows) {
      exportItems.push(toItemSnapshot(r));
    }
  }

  // ─── Activity rows where caller is the actor ─────────────────────
  const activityRows = await db
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
    .where(eq(activityLog.actorId, userId));

  const exportActivity: ActivityFeedRow[] = activityRows.map((r) => ({
    id: r.id,
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

  // ─── Messages (caller-only) ──────────────────────────────────────
  const messageRows = await getAllMessagesForUser(userId);
  const exportMessages: ExportBundle["messages"] = messageRows.map((m) => ({
    role: m.role as MessageRole,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  return {
    generatedAt: new Date().toISOString(),
    user: {
      telegramId: user.telegramId,
      locale: user.locale,
      timezone: user.timezone,
    },
    lists: exportLists,
    items: exportItems,
    activity: exportActivity,
    messages: exportMessages,
  };
}
