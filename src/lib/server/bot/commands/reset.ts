/**
 * /reset — clear conversation history for the current (user, chat).
 */
import type { Context } from "grammy";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { messages } from "@/lib/db/schema";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleReset(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);
  const chatId = message.chat.id;

  await db
    .delete(messages)
    .where(and(eq(messages.userId, user.id), eq(messages.chatId, chatId)));

  await ctx.reply(
    locale === "tr"
      ? "✓ Konuşma geçmişi silindi."
      : "✓ Conversation history cleared.",
  );
}
