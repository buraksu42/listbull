import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists } from "@/lib/db/schema";
import type { Item, List, NewList } from "@/lib/types";

/** A list row with active item counts attached — used for the lists overview. */
export type ListWithCounts = List & {
  openCount: number;
  doneCount: number;
};

/**
 * Ensure the user has an Inbox list. Idempotent — only creates one if missing.
 * Phase 1: called from /start command and any first-touch entry point.
 */
export async function ensureInbox(userId: string): Promise<List> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.lists.findFirst({
      where: and(eq(lists.ownerId, userId), eq(lists.isInbox, true)),
    });
    if (existing) return existing;

    const insertValues: NewList = {
      name: "Inbox",
      emoji: "📥",
      ownerId: userId,
      isInbox: true,
    };
    const [created] = await tx.insert(lists).values(insertValues).returning();
    if (!created) {
      throw new Error("ensureInbox: insert returned no row");
    }

    await tx.insert(listMembers).values({
      listId: created.id,
      userId,
      role: "owner",
    });

    return created;
  });
}

/**
 * All lists the user can see, with item counts (active items broken into
 * open vs done so the UI can show "3 / 7" or "3 görev" depending on
 * preference). Joined via list_members (every owner gets a row at
 * create-time, so this covers owned + shared lists in one query).
 * Inbox first, then by createdAt asc.
 */
export async function listListsForUser(userId: string): Promise<ListWithCounts[]> {
  const rows = await db
    .select({
      list: lists,
      openCount: sql<number>`count(*) filter (where ${items.id} is not null and ${items.isDone} = false and ${items.archivedAt} is null)`,
      doneCount: sql<number>`count(*) filter (where ${items.id} is not null and ${items.isDone} = true and ${items.archivedAt} is null)`,
    })
    .from(listMembers)
    .innerJoin(lists, eq(listMembers.listId, lists.id))
    .leftJoin(items, eq(items.listId, lists.id))
    .where(and(eq(listMembers.userId, userId), isNull(lists.archivedAt)))
    .groupBy(lists.id)
    .orderBy(asc(lists.createdAt));

  return rows
    .map((row) => ({
      ...row.list,
      openCount: Number(row.openCount),
      doneCount: Number(row.doneCount),
    }))
    .sort((a, b) => {
      if (a.isInbox && !b.isInbox) return -1;
      if (!a.isInbox && b.isInbox) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
}

/** Whether the given user has any visibility on the list (owner or member). */
export async function userCanReadList(
  userId: string,
  listId: string,
): Promise<boolean> {
  const member = await db.query.listMembers.findFirst({
    where: and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)),
  });
  return !!member;
}

/** Get a list by ID; returns undefined if missing or archived. */
export async function getList(listId: string): Promise<List | undefined> {
  return db.query.lists.findFirst({
    where: and(eq(lists.id, listId), isNull(lists.archivedAt)),
  });
}

/** Items in a list, ordered for display (active first, then position). */
export async function listItemsInList(listId: string): Promise<Item[]> {
  return db
    .select()
    .from(items)
    .where(and(eq(items.listId, listId), isNull(items.archivedAt)))
    .orderBy(asc(items.isDone), asc(items.position), asc(items.createdAt));
}
