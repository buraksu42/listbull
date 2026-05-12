import type { Context } from "grammy";

import { listListsForUser } from "@/lib/db/queries/lists";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { pickLocale, t } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";

export async function handleLists(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    // No /start has been run yet — fall through to start instead of crashing.
    await ctx.reply("Run /start first.");
    return;
  }

  const workspaceId = await resolveActiveWorkspaceId(user.id);
  const lists = await listListsForUser(user.id, workspaceId);
  const locale = pickLocale(user.locale);
  const tr = t(locale);

  if (lists.length === 0) {
    await ctx.reply(tr.noLists);
    return;
  }

  // Inline keyboard with `web_app` buttons opens the Mini App
  // directly in Telegram's WebApp container — no "Open this link?"
  // prompt, no browser detour, no t.me/startapp roundtrip (which
  // some Telegram clients fail to resolve from within the same
  // bot's chat with an "invalid" error).
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
