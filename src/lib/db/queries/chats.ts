/**
 * Chat + chat_member query helpers (Phase 17).
 *
 * Chats are lazily created on first bot interaction. Membership is
 * synced from Telegram `chat_member` updates; we keep our own row so
 * the assignee picker + activity feed don't round-trip Telegram.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chatMembers, chats, users } from "@/lib/db/schema";
import type { Chat, ChatType } from "@/lib/types";

export async function getChatById(chatId: number): Promise<Chat | undefined> {
  return db.query.chats.findFirst({ where: eq(chats.chatId, chatId) });
}

export type EnsureChatInput = {
  chatId: number;
  type: ChatType;
  title: string | null;
  ownerUserId: string;
};

/**
 * Insert or fetch the chat row. Idempotent — re-running with the same
 * chat_id is a no-op (ON CONFLICT DO NOTHING). On insert, also seed
 * a chat_members row for the owner.
 */
export async function ensureChat(input: EnsureChatInput): Promise<Chat> {
  const existing = await getChatById(input.chatId);
  if (existing) {
    // Kick → re-add cycle leaves archivedAt set from my_chat_member.
    // On re-entry, clear it so cron + LLM treat the chat as live
    // again. Title may have changed too; refresh while we're here.
    if (existing.archivedAt !== null || existing.title !== input.title) {
      await db
        .update(chats)
        .set({
          archivedAt: null,
          title: input.title,
          updatedAt: new Date(),
        })
        .where(eq(chats.chatId, input.chatId));
      const refreshed = await getChatById(input.chatId);
      if (refreshed) return refreshed;
    }
    return existing;
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(chats)
      .values({
        chatId: input.chatId,
        type: input.type,
        title: input.title,
        ownerUserId: input.ownerUserId,
      })
      .onConflictDoNothing({ target: chats.chatId });
    await tx
      .insert(chatMembers)
      .values({
        chatId: input.chatId,
        userId: input.ownerUserId,
      })
      .onConflictDoNothing();
  });

  const row = await getChatById(input.chatId);
  if (!row) throw new Error("ensureChat: row missing after insert");
  return row;
}

/** Upsert a chat_members row from a Telegram chat_member event. */
export async function upsertChatMember(
  chatId: number,
  userId: string,
): Promise<void> {
  await db
    .insert(chatMembers)
    .values({ chatId, userId })
    .onConflictDoNothing();
}

/** Remove a chat_members row (user left or was kicked). */
export async function removeChatMember(
  chatId: number,
  userId: string,
): Promise<void> {
  await db
    .delete(chatMembers)
    .where(
      and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)),
    );
}

/**
 * Enumerate the chat's members joined with user profile info. Used by
 * the `list_chat_members` tool ("kim bu chat'te?").
 */
export async function listChatMembers(chatId: number): Promise<
  Array<{
    userId: string;
    telegramUsername: string | null;
    telegramFirstName: string;
    joinedAt: Date;
  }>
> {
  const rows = await db
    .select({
      userId: chatMembers.userId,
      telegramUsername: users.telegramUsername,
      telegramFirstName: users.telegramFirstName,
      joinedAt: chatMembers.joinedAt,
    })
    .from(chatMembers)
    .innerJoin(users, eq(users.id, chatMembers.userId))
    .where(eq(chatMembers.chatId, chatId))
    .orderBy(desc(chatMembers.joinedAt));
  return rows;
}
