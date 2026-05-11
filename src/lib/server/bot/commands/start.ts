import type { Context } from "grammy";

import { env } from "@/lib/env";
import { ensureInbox } from "@/lib/db/queries/lists";
import { upsertUserFromTelegram } from "@/lib/db/queries/users";
import { pickLocale, t } from "@/lib/server/bot/i18n";

/**
 * `/start` handler — onboarding + Inbox creation. As of 2026-05-08
 * also handles the `?start=<payload>` deep-link param so users who
 * arrive via an invite-accept flow see a contextual welcome instead
 * of the generic onboarding text.
 *
 * Recognized payloads:
 *   - `joined_<listId>` — the user just accepted an invite to that
 *     list. Welcome them + offer a Mini App deeplink to that list.
 *
 * Unrecognized payloads fall through to the default welcome.
 */
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

  // grammY's bot.command("start") populates ctx.match with the
  // text after the command (i.e. the deep-link payload from
  // ?start=<payload>).
  const payload =
    typeof (ctx as unknown as { match?: unknown }).match === "string"
      ? ((ctx as unknown as { match: string }).match || "").trim()
      : "";

  if (payload.startsWith("joined_")) {
    const listId = payload.slice("joined_".length);
    const miniAppUrl = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=list_${listId}`;
    const greeting =
      locale === "tr"
        ? `Hoş geldin, ${user.telegramFirstName}! Listeyi açmak için: ${miniAppUrl}`
        : `Welcome, ${user.telegramFirstName}! Open the list: ${miniAppUrl}`;
    await ctx.reply(greeting);
    return;
  }

  // Plain text (no parse_mode) — MarkdownV2 reserved characters (!, ., -, etc.)
  // would all need escaping which makes the welcome copy unreadable in source.
  // Phase 2 LLM router (handle-message.ts) already settled on plain text;
  // /start now matches that convention.
  const text = tr.welcome(user.telegramFirstName, user.timezone);

  await ctx.reply(text);
}
