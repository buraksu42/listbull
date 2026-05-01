/**
 * Item-level query helpers used by tool executors and the items API
 * route. Membership/role checks live here too so executors and routes
 * share one canonical path.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers } from "@/lib/db/schema";
import type { Item, ListRole, NewItem } from "@/lib/types";

/** Roles allowed to mutate items in a list. Viewer is read-only. */
const WRITE_ROLES: ListRole[] = ["owner", "editor"];

/**
 * Fetch one item by primary key. Returns undefined for missing rows.
 * Does NOT filter by `archivedAt` — caller decides whether soft-deleted
 * rows are visible (e.g. `delete_item` rejects archived items, the
 * Mini App route hides them).
 */
export async function getItem(id: string): Promise<Item | undefined> {
  return db.query.items.findFirst({ where: eq(items.id, id) });
}

/**
 * Insert one item row, returning the persisted row.
 */
export async function insertItem(values: NewItem): Promise<Item> {
  const [row] = await db.insert(items).values(values).returning();
  if (!row) throw new Error("insertItem: insert returned no row");
  return row;
}

/**
 * Apply a partial patch to an item. Returns the post-update row.
 * Caller is responsible for the membership check + activity_log write
 * (those happen inside the executor's transaction).
 */
export async function updateItem(
  id: string,
  patch: Partial<NewItem>,
): Promise<Item | undefined> {
  const [row] = await db
    .update(items)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(items.id, id))
    .returning();
  return row;
}

/**
 * Soft-delete: set `archived_at = now()`. Returns the post-archive row.
 */
export async function archiveItem(id: string): Promise<Item | undefined> {
  const now = new Date();
  const [row] = await db
    .update(items)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(items.id, id))
    .returning();
  return row;
}

/**
 * Membership predicate: does the user have write access (owner|editor)
 * to the given list? Used by every mutation tool executor and Mini App
 * mutation route.
 */
export async function userCanWriteList(
  userId: string,
  listId: string,
): Promise<boolean> {
  const member = await db.query.listMembers.findFirst({
    where: and(
      eq(listMembers.listId, listId),
      eq(listMembers.userId, userId),
      inArray(listMembers.role, WRITE_ROLES),
    ),
  });
  return !!member;
}
