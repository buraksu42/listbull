/**
 * D2 read-side snapshot assembler (Phase 4).
 *
 * `getSnapshotPublic(listId)` produces the JSON-safe `SnapshotPublic`
 * shape consumed by `(marketing)/snapshot/[id]` and the bot's snapshot
 * message. The contract is "current state at request time" — no DB
 * column stores snapshots; expiration is URL-bound (Inv-18) so the
 * schema stays frozen.
 *
 * Excludes: assignees, due dates timestamps to the second (ISO-only),
 * members, activity. The snapshot is a forwardable read-only artifact,
 * not a fully-functional list view.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, lists, users } from "@/lib/db/schema";
import type { SnapshotPublic } from "@/lib/types";

export async function getSnapshotPublic(
  listId: string,
  expiresAtIso: string,
): Promise<SnapshotPublic | null> {
  const [listRow] = await db
    .select({
      id: lists.id,
      name: lists.name,
      emoji: lists.emoji,
      ownerId: lists.ownerId,
      isInbox: lists.isInbox,
      ownerFirstName: users.telegramFirstName,
    })
    .from(lists)
    .innerJoin(users, eq(users.id, lists.ownerId))
    .where(and(eq(lists.id, listId), isNull(lists.archivedAt)))
    .limit(1);

  if (!listRow) return null;
  // Inbox cannot be snapshotted (privacy: it's the user's catch-all).
  if (listRow.isInbox) return null;

  const itemRows = await db
    .select({
      text: items.text,
      isDone: items.isDone,
      deadlineAt: items.deadlineAt,
      isCheckable: items.isCheckable,
      position: items.position,
      createdAt: items.createdAt,
    })
    .from(items)
    .where(and(eq(items.listId, listId), isNull(items.archivedAt)))
    .orderBy(
      sql`${items.pinnedAt} DESC NULLS LAST`,
      asc(items.isDone),
      asc(items.position),
      asc(items.createdAt),
    );

  const capturedAt = new Date().toISOString();

  return {
    listId: listRow.id,
    listName: listRow.name,
    listEmoji: listRow.emoji,
    capturedAt,
    expiresAt: expiresAtIso,
    items: itemRows.map((r) => ({
      text: r.text,
      isDone: r.isDone,
      deadlineAt: r.deadlineAt ? r.deadlineAt.toISOString() : null,
    })),
    ownerFirstName: listRow.ownerFirstName,
  };
}
