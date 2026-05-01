import type { Context } from "grammy";

import { listListsForUser } from "@/lib/db/queries/lists";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { escapeMarkdownV2 } from "@/lib/server/bot/escape-markdown";
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

  const lists = await listListsForUser(user.id);
  const locale = pickLocale(user.locale);
  const tr = t(locale);

  if (lists.length === 0) {
    await ctx.reply(tr.noLists);
    return;
  }

  const header = `*${escapeMarkdownV2(tr.listsHeader)}*`;
  const lines = lists.map((list) => {
    const emoji = list.emoji ?? (list.isInbox ? "📥" : "•");
    const name = list.isInbox ? tr.inboxLabel : list.name;
    const deeplink = `${env.NEXT_PUBLIC_APP_URL}/lists/${list.id}`;
    return `${escapeMarkdownV2(emoji)} [${escapeMarkdownV2(name)}](${deeplink})`;
  });

  const message = [header, ...lines].join("\n");
  await ctx.reply(message, {
    parse_mode: "MarkdownV2",
    link_preview_options: { is_disabled: true },
  });
}
