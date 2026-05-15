/**
 * Item query helpers (Phase 17 chat-only).
 *
 * Access control is now purely chat-membership: if you're a member of
 * the chat (`chat_members`), you can read + write any item in that chat.
 * No list_members concept, no workspace roles.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chatMembers, items } from "@/lib/db/schema";
import type { Item, NewItem } from "@/lib/types";

/** Fetch one item by primary key. Returns undefined for missing rows. */
export async function getItem(id: string): Promise<Item | undefined> {
  return db.query.items.findFirst({ where: eq(items.id, id) });
}

/** Insert one item row, returning the persisted row. */
export async function insertItem(values: NewItem): Promise<Item> {
  const [row] = await db.insert(items).values(values).returning();
  if (!row) throw new Error("insertItem: insert returned no row");
  return row;
}

/** Apply a partial patch to an item. */
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

/** Soft-delete: set archived_at = now(). */
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
 * Chat membership predicate: is the user a member of the chat? Used
 * by Mini App routes (now redirected). For the bot path, handle-message
 * resolves chat membership via ensureChat which auto-onboards the user.
 */
export async function userIsChatMember(
  userId: string,
  chatId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: chatMembers.id })
    .from(chatMembers)
    .where(
      and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)),
    )
    .limit(1);
  return rows.length > 0;
}
