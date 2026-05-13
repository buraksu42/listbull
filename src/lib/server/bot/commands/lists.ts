import type { Context } from "grammy";

import { listListsForUser } from "@/lib/db/queries/lists";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import {
  getWorkspaceByChatId,
  resolveActiveWorkspaceId,
} from "@/lib/db/queries/workspaces";
import { pickLocale, t } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";

export async function handleLists(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || !chat) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    // No /start has been run yet — fall through to start instead of crashing.
    await ctx.reply("Run /start first.");
    return;
  }

  const isGroup = chat.type === "group" || chat.type === "supergroup";

  // Group context routes to the bound workspace, not the user's
  // active one — so `/lists` in a bound group shows the group's
  // workspace lists, not the user's personal ones.
  let workspaceId: string;
  if (isGroup) {
    const bound = await getWorkspaceByChatId(chat.id);
    if (!bound) {
      // Re-use the handle-message copy via a tiny inline string —
      // group not bound, nothing to show.
      const msg =
        user.locale === "tr"
          ? "Bu grup henüz bir workspace'e bağlı değil. /bindgroup ile bağla."
          : "This group isn't bound to a workspace yet. Run /bindgroup.";
      await ctx.reply(msg);
      return;
    }
    workspaceId = bound.id;
  } else {
    workspaceId = await resolveActiveWorkspaceId(user.id);
  }

  const lists = await listListsForUser(user.id, workspaceId);
  const locale = pickLocale(user.locale);
  const tr = t(locale);

  if (lists.length === 0) {
    await ctx.reply(tr.noLists);
    return;
  }

  // Group chats reject `web_app` inline buttons (Telegram API:
  // BUTTON_TYPE_INVALID), so we render plain text in groups. In
  // private chat the web_app button opens the Mini App directly
  // with no t.me/startapp roundtrip.
  if (isGroup) {
    const lines = [tr.listsHeader, ""];
    for (const list of lists) {
      const emoji = list.emoji ?? (list.isInbox ? "📥" : "•");
      const name = list.isInbox ? tr.inboxLabel : list.name;
      lines.push(`${emoji} ${name}`);
    }
    lines.push("");
    lines.push(
      locale === "tr"
        ? `📲 Yönetmek için Mini App'i aç: t.me/${env.TELEGRAM_BOT_USERNAME}/app`
        : `📲 Open Mini App to manage: t.me/${env.TELEGRAM_BOT_USERNAME}/app`,
    );
    await ctx.reply(lines.join("\n"));
    return;
  }

  await ctx.reply(tr.listsHeader, {
    reply_markup: {
      inline_keyboard: lists.map((list) => {
        const emoji = list.emoji ?? (list.isInbox ? "📥" : "•");
        const name = list.isInbox ? tr.inboxLabel : list.name;
        return [
          {
            text: `${emoji} ${name}`,
            web_app: {
              url: `${env.NEXT_PUBLIC_APP_URL}/lists/${list.id}`,
            },
          },
        ];
      }),
    },
  });
}
