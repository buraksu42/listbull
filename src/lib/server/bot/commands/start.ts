import type { Context } from "grammy";

import { ensureInbox } from "@/lib/db/queries/lists";
import { upsertUserFromTelegram } from "@/lib/db/queries/users";
import { escapeMarkdownV2 } from "@/lib/server/bot/escape-markdown";
import { pickLocale, t } from "@/lib/server/bot/i18n";

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await upsertUserFromTelegram({
    telegramId: from.id,
    telegramUsername: from.username ?? null,
    telegramFirstName: from.first_name,
    telegramLastName: from.last_name ?? null,
    telegramPhotoUrl: null,
    languageCode: from.language_code ?? null,
  });

  await ensureInbox(user.id);

  const locale = pickLocale(user.locale);
  const tr = t(locale);
  const text = tr.welcome(escapeMarkdownV2(user.telegramFirstName));

  await ctx.reply(text, { parse_mode: "MarkdownV2" });
}
