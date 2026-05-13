/**
 * `my_chat_member` update handler — fires when the bot's own
 * membership in a chat changes (added, removed, promoted, kicked).
 *
 * For groups/supergroups:
 *   - Status flips to "kicked" or "left" → auto-unbind whichever
 *     workspace owns this chat (the link is now dead anyway; no
 *     reason to keep a stale row).
 *   - Status flips to "member" or "administrator" (bot freshly
 *     added) → DM the inviter telling them how to /bindgroup.
 *
 * Private chats are ignored.
 */
import type { Context } from "grammy";

import { getUserByTelegramId } from "@/lib/db/queries/users";
import { unbindChat } from "@/lib/db/queries/workspaces";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleMyChatMember(ctx: Context): Promise<void> {
  const update = ctx.update.my_chat_member;
  if (!update) return;
  const chat = update.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return;

  const oldStatus = update.old_chat_member.status;
  const newStatus = update.new_chat_member.status;

  // Removed: clear the binding.
  if (
    newStatus === "kicked" ||
    newStatus === "left" ||
    newStatus === "restricted"
  ) {
    await unbindChat(chat.id);
    return;
  }

  // Added: tell whoever added the bot how to bind.
  if (
    (oldStatus === "left" || oldStatus === "kicked") &&
    (newStatus === "member" || newStatus === "administrator")
  ) {
    const inviter = update.from;
    if (!inviter) return;
    const user = await getUserByTelegramId(inviter.id);
    const locale = pickLocale(user?.locale ?? inviter.language_code ?? null);

    const chatIdStr = String(chat.id);
    const groupLabel: string =
      "title" in chat && typeof chat.title === "string"
        ? chat.title
        : chatIdStr;
    const msg =
      locale === "tr"
        ? `Beni "${groupLabel}" grubuna eklediğin için teşekkürler. Grup'tan to-do açabilmek için bir workspace bağlamak gerek:\n\n1. O grupta /bindgroup yaz.\n2. Sahibi olduğun workspace'lerden birini seç.\n3. Üyeleri davet et (DM'imden /share veya Mini App'ten).\n\nBaşka soru olursa /help yaz.`
        : `Thanks for adding me to "${groupLabel}"! To capture to-dos from the group, bind a workspace:\n\n1. In the group, run /bindgroup.\n2. Pick one of the workspaces you own.\n3. Invite members (DM /share or via the Mini App).\n\nRun /help here for more.`;

    try {
      await ctx.api.sendMessage(inviter.id, msg);
    } catch {
      // The inviter may not have DMed the bot yet — they'll see
      // the /bindgroup hint in-group when they try to use the bot.
    }
  }
}
