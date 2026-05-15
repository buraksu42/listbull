/**
 * `/workspace` — show workspace switcher inline keyboard so the user
 * can flip their active workspace without leaving Telegram.
 *
 * Renders a button per workspace; active one is marked with a star.
 * Tap → callback `wsswitch:<workspaceId>` → setActiveWorkspace +
 * confirm. Works in both DM and group context (in groups, the active
 * workspace is per-USER, not chat-bound — the bound workspace is a
 * separate concept).
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";

import { getUserByTelegramId } from "@/lib/db/queries/users";
import {
  listWorkspacesForUser,
  resolveActiveWorkspaceId,
} from "@/lib/db/queries/workspaces";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleWorkspace(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);

  const [workspaces, activeId] = await Promise.all([
    listWorkspacesForUser(user.id),
    resolveActiveWorkspaceId(user.id),
  ]);

  if (workspaces.length === 0) {
    await ctx.reply(
      locale === "tr"
        ? "Henüz bir workspace'in yok. Bot'a 'yeni alan oluştur' yaz."
        : "You don't have any workspace yet. Tell me 'create a new workspace'.",
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const w of workspaces) {
    const star = w.id === activeId ? "⭐ " : "";
    const tag = w.isPersonal
      ? locale === "tr"
        ? " (kişisel)"
        : " (personal)"
      : "";
    keyboard.text(`${star}${w.name}${tag}`, `wsswitch:${w.id}`).row();
  }

  await ctx.reply(
    locale === "tr"
      ? "Hangi workspace'e geçeyim?"
      : "Switch to which workspace?",
    { reply_markup: keyboard },
  );
}
