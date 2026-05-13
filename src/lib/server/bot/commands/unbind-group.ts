/**
 * `/unbindgroup` — remove the workspace ↔ group binding for this chat.
 *
 * Only the workspace owner can unbind. Group-context only. The bot
 * removes the link; the workspace itself stays intact. To rebind,
 * run /bindgroup again.
 */
import type { Context } from "grammy";

import { getUserByTelegramId } from "@/lib/db/queries/users";
import {
  getWorkspaceByChatId,
  unbindChat,
} from "@/lib/db/queries/workspaces";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleUnbindGroup(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  const chat = ctx.chat;
  if (!from || !message || !chat) return;

  const isGroup = chat.type === "group" || chat.type === "supergroup";
  if (!isGroup) {
    await ctx.reply(
      "Bu komut grup içinde çalışır. Bağlı grup'tan /unbindgroup yaz.",
    );
    return;
  }

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Önce DM'imden /start at.");
    return;
  }
  const locale = pickLocale(user.locale);

  const ws = await getWorkspaceByChatId(chat.id);
  if (!ws) {
    await ctx.reply(
      locale === "tr"
        ? "Bu grup zaten bir workspace'e bağlı değil."
        : "This group isn't bound to any workspace.",
      { reply_parameters: { message_id: message.message_id } },
    );
    return;
  }

  if (ws.ownerId !== user.id) {
    await ctx.reply(
      locale === "tr"
        ? `Sadece "${ws.name}" workspace'inin sahibi /unbindgroup yapabilir.`
        : `Only the owner of "${ws.name}" can /unbindgroup.`,
      { reply_parameters: { message_id: message.message_id } },
    );
    return;
  }

  await unbindChat(chat.id);
  await ctx.reply(
    locale === "tr"
      ? `✓ "${ws.name}" bağlantısı kaldırıldı. Bu grupta artık mesajlara cevap vermem.`
      : `✓ Unbound "${ws.name}". I won't respond to messages in this group anymore.`,
  );
}
