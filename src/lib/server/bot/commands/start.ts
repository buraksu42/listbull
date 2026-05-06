import type { Context } from "grammy";

import { ensureInbox } from "@/lib/db/queries/lists";
import { upsertUserFromTelegram } from "@/lib/db/queries/users";
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
  // Plain text (no parse_mode) — MarkdownV2 reserved characters (!, ., -, etc.)
  // would all need escaping which makes the welcome copy unreadable in source.
  // Phase 2 LLM router (handle-message.ts) already settled on plain text;
  // /start now matches that convention.
  const text = tr.welcome(user.telegramFirstName);

  await ctx.reply(text);
}
