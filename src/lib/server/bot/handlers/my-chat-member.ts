/**
 * `my_chat_member` update handler (Phase 17 chat-only).
 *
 * Bot added → ensure chats row with the inviter as owner + DM them
 * "set your OpenRouter key here" so the group becomes active.
 * Bot removed → archive the chat (cron + bot won't act on it).
 */
import type { Context } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";
import { ensureChat } from "@/lib/db/queries/chats";
import { getUserByTelegramId, upsertUserFromTelegram } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";
import type { ChatType } from "@/lib/types";

export async function handleMyChatMember(ctx: Context): Promise<void> {
  const update = ctx.update.my_chat_member;
  if (!update) return;
  const chat = update.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return;

  const oldStatus = update.old_chat_member.status;
  const newStatus = update.new_chat_member.status;

  // Removed: archive the chat.
  if (
    newStatus === "kicked" ||
    newStatus === "left" ||
    newStatus === "restricted"
  ) {
    await db
      .update(chats)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(chats.chatId, chat.id));
    return;
  }

  // Added: create chat row + DM inviter.
  if (
    (oldStatus === "left" || oldStatus === "kicked") &&
    (newStatus === "member" || newStatus === "administrator")
  ) {
    const inviter = update.from;
    if (!inviter) return;

    // Upsert the inviter so we have a users row to own the chat.
    const owner = await upsertUserFromTelegram({
      telegramId: inviter.id,
      telegramUsername: inviter.username ?? null,
      telegramFirstName: inviter.first_name,
      telegramLastName: inviter.last_name ?? null,
      telegramPhotoUrl: null,
      languageCode: inviter.language_code ?? null,
    });

    const chatIdStr = String(chat.id);
    const groupLabel =
      "title" in chat && typeof chat.title === "string"
        ? chat.title
        : chatIdStr;

    await ensureChat({
      chatId: chat.id,
      type: chat.type as ChatType,
      title: groupLabel,
      ownerUserId: owner.id,
    });

    const locale = pickLocale(owner.locale ?? inviter.language_code ?? null);
    const msg =
      locale === "tr"
        ? `Beni "${groupLabel}" grubuna eklediğin için sağol. Grup'ta çalışabilmem için bir OpenRouter API key gerek (chat sahibisin → sen ekleyeceksin):\n\n1. openrouter.ai/keys → Sign in → Create Key\n2. Key'i (sk-or-v1-… ile başlar) bu DM'e yapıştır — kaydederim, mesajını silerim.\n\nSonra grupta @${ctx.me.username} ile mesaj atan herkes liste kullanabilir.`
        : `Thanks for adding me to "${groupLabel}"! I need an OpenRouter API key for this chat (you're the owner → you set it):\n\n1. openrouter.ai/keys → Sign in → Create Key\n2. Paste the key (sk-or-v1-…) into THIS DM — I save it and delete your message.\n\nThen anyone who mentions @${ctx.me.username} in the group can use the list.`;

    try {
      await ctx.api.sendMessage(inviter.id, msg);
    } catch {
      // Inviter hasn't started bot DM yet — they'll see prompts in-group.
    }
  }
}
