/**
 * `chat_member` update handler (Phase 17).
 *
 * Fires when ANOTHER user's membership in a group changes. We mirror
 * it into our `chat_members` table so the assignee picker + activity
 * feed stay consistent without round-tripping Telegram.
 *
 * Telegram requires `chat_member` to be in `allowed_updates` AND the
 * bot to be an administrator in the group to receive these events.
 * Without admin, we fall back to lazy add on first message.
 */
import type { Context } from "grammy";

import {
  removeChatMember,
  upsertChatMember,
} from "@/lib/db/queries/chats";
import { upsertUserFromTelegram } from "@/lib/db/queries/users";

export async function handleChatMemberUpdate(ctx: Context): Promise<void> {
  const update = ctx.update.chat_member;
  if (!update) return;
  const chat = update.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return;

  const target = update.new_chat_member.user;
  const newStatus = update.new_chat_member.status;

  // Member left or was removed → drop our row.
  if (
    newStatus === "kicked" ||
    newStatus === "left" ||
    newStatus === "restricted"
  ) {
    // We need the user's UUID for the delete; upsert via telegramId.
    const dbUser = await upsertUserFromTelegram({
      telegramId: target.id,
      telegramUsername: target.username ?? null,
      telegramFirstName: target.first_name,
      telegramLastName: target.last_name ?? null,
      telegramPhotoUrl: null,
      languageCode: target.language_code ?? null,
    });
    await removeChatMember(chat.id, dbUser.id);
    return;
  }

  // Member added or rejoined → upsert our row.
  if (
    newStatus === "member" ||
    newStatus === "administrator" ||
    newStatus === "creator"
  ) {
    const dbUser = await upsertUserFromTelegram({
      telegramId: target.id,
      telegramUsername: target.username ?? null,
      telegramFirstName: target.first_name,
      telegramLastName: target.last_name ?? null,
      telegramPhotoUrl: null,
      languageCode: target.language_code ?? null,
    });
    await upsertChatMember(chat.id, dbUser.id);
  }
}
