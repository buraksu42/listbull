/**
 * /start — onboarding (Phase 17 chat-only).
 *
 * No more invite-link payloads (workspace/list invites removed). On
 * DM /start: upsert user + ensure chat row. On group /start: send a
 * short welcome + tell users to chat in DM for personal lists.
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";

import { ensureChat } from "@/lib/db/queries/chats";
import { upsertUserFromTelegram } from "@/lib/db/queries/users";
import { pickLocale, t } from "@/lib/server/bot/i18n";
import type { ChatType } from "@/lib/types";

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;

  const user = await upsertUserFromTelegram({
    telegramId: from.id,
    telegramUsername: from.username ?? null,
    telegramFirstName: from.first_name,
    telegramLastName: from.last_name ?? null,
    telegramPhotoUrl: null,
    languageCode: from.language_code ?? null,
  });

  const chatType = message.chat.type as ChatType;
  await ensureChat({
    chatId: message.chat.id,
    type: chatType,
    title:
      message.chat.type === "private"
        ? null
        : (message.chat as { title?: string }).title ?? null,
    ownerUserId: user.id,
  });

  const locale = pickLocale(user.locale);
  const tr = t(locale);
  const keyboard = new InlineKeyboard().text(
    locale === "tr" ? "🎯 Hızlı tur (3 dk)" : "🎯 Quick tour (3 min)",
    "tour:step:0",
  );
  await ctx.reply(tr.welcome(user.telegramFirstName, user.timezone), {
    reply_markup: keyboard,
  });
}
