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
import { insertBotActionContext } from "@/lib/db/queries/bot-action-contexts";
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
    // No inline marker — the action context (action=set_key,
    // target_chat_id=group) is persisted by message_id so the
    // key-paste intercept in handle-message can resolve it from
    // reply_to_message.message_id alone.
    const msg =
      locale === "tr"
        ? `👥 Beni "${groupLabel}" grubuna eklediğin için sağol! Bu grubu çalıştırmam için bir OpenRouter API key gerek (chat sahibi sensin):\n\n🔑 Adımlar:\n  1. openrouter.ai/keys → Sign in → Create Key\n  2. Key'i (sk-or-v1-… ile başlar) BU MESAJI YANITLAYARAK gönder → grup'a özel kaydederim + DM mesajını güvenlik için silerim.\n\n✨ Sonra grup'ta @${ctx.me.username} ile mesaj atan herkes liste kullanabilir.`
        : `👥 Thanks for adding me to "${groupLabel}"! I need an OpenRouter API key to run this group (you're the owner):\n\n🔑 Steps:\n  1. openrouter.ai/keys → Sign in → Create Key\n  2. REPLY to this message with the key (sk-or-v1-…) → I save it for the group and delete your DM for safety.\n\n✨ Then anyone who mentions @${ctx.me.username} in the group can use the list.`;

    try {
      const sent = await ctx.api.sendMessage(inviter.id, msg, {
        reply_markup: {
          force_reply: true,
          selective: true,
        },
      });
      // Persist the action context against the DM message_id so
      // handle-message can route the reply's key to this group.
      await insertBotActionContext({
        chatId: inviter.id, // DM chat = the inviter's user_id in Telegram
        messageId: sent.message_id,
        action: "set_key",
        itemId: null,
        targetChatId: chat.id,
      });
    } catch {
      // Inviter hasn't started bot DM yet — they'll see prompts in-group.
    }
  }
}
