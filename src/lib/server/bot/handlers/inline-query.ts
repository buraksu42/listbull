/**
 * D1 — bot inline-query handler (Phase 4).
 *
 * `@listgram_bot <query>` in any Telegram chat. Returns up to 10
 * `InlineQueryResultArticle` rows (Telegram's API caps at 50; we cap
 * at 10 per Architect's contract for sub-100ms latency + UI density).
 *
 * Identification: inline mode has no session — `ctx.from.id` is the
 * only signal. We resolve the calling Telegram user → `users.id` via
 * the standard `getUserByTelegramId` lookup. If unknown (no `/start`
 * yet), we answer with an empty result list (silent — Telegram doesn't
 * support an "auth required" hint in inline mode without a redirect
 * button, which would complicate the no-LLM path).
 *
 * Tap behavior: `input_message_content` carries a deeplink to the
 * Mini App at the item's list, so when the picker tap inserts the
 * result into the chat, it's a clickable Mini App deeplink (per Phase
 * 4 contract — "open Mini App at the list" is the ship target; the
 * "add as item" tap action is deferred).
 */
import "server-only";

import type { Context } from "grammy";
import type { InlineQueryResultArticle } from "grammy/types";

import {
  INLINE_RESULT_CAP,
  searchInlineItems,
} from "@/lib/db/queries/inline";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";
import type { InlineQueryResult } from "@/lib/types";

/** Inline result titles cap at 64 chars per Telegram's UI conventions. */
const TITLE_MAX = 64;
const DESC_MAX = 100;

/** Telegram inline-query cache: 30s. Re-query is sub-100ms; small TTL. */
const CACHE_SECONDS = 30;

export async function handleInlineQuery(ctx: Context): Promise<void> {
  const inline = ctx.inlineQuery;
  if (!inline) return;

  const tgUserId = ctx.from?.id;
  if (!tgUserId) {
    await ctx.answerInlineQuery([], { cache_time: CACHE_SECONDS });
    return;
  }

  const user = await getUserByTelegramId(tgUserId);
  if (!user) {
    // No /start yet → no items to surface.
    await ctx.answerInlineQuery([], { cache_time: CACHE_SECONDS });
    return;
  }

  const locale = pickLocale(user.locale);
  const rows = await searchInlineItems(user.id, inline.query ?? "");

  const articles: InlineQueryResultArticle[] = rows.map((row) => {
    const result = mapRowToInlineResult(row, locale);
    return {
      type: "article",
      id: result.id,
      title: result.title,
      description: result.description,
      input_message_content: {
        message_text: result.deeplink,
        link_preview_options: { is_disabled: false },
      },
      ...(result.thumbUrl ? { thumb_url: result.thumbUrl } : {}),
    };
  });

  await ctx.answerInlineQuery(articles, {
    cache_time: CACHE_SECONDS,
    is_personal: true,
  });
}

/**
 * Pure transform — kept exportable so unit tests can assert mapping
 * without spinning up a grammY mock.
 */
export function mapRowToInlineResult(
  row: {
    itemId: string;
    itemText: string;
    itemIsDone: boolean;
    itemCreatedAt: string;
    listId: string;
    listName: string;
    listEmoji: string | null;
  },
  locale: "tr" | "en",
): InlineQueryResult {
  const emoji = row.listEmoji ?? "📋";
  const titleRaw = row.itemText.replace(/\s+/g, " ").trim();
  const title = titleRaw.length > TITLE_MAX
    ? `${titleRaw.slice(0, TITLE_MAX - 1)}…`
    : titleRaw;

  const doneSuffix = row.itemIsDone
    ? locale === "tr"
      ? " · ✓ tamamlandı"
      : " · ✓ done"
    : "";
  const ageLabel = relativeAge(row.itemCreatedAt, locale);
  const description =
    `${emoji} ${row.listName} · ${ageLabel}${doneSuffix}`.slice(0, DESC_MAX);

  // Mini App deeplink — the Telegram chat receives the URL as a regular
  // message; tapping opens t.me/<bot>?startapp which Telegram resolves
  // to the Mini App and our layout reads `startapp=item_<id>`.
  const startapp = `item_${row.itemId}`;
  const deeplink = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=${startapp}`;

  return {
    id: row.itemId,
    type: "article",
    title,
    description,
    deeplink,
  };
}

function relativeAge(iso: string, locale: "tr" | "en"): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (deltaSec < 60) return locale === "tr" ? "az önce" : "just now";
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) {
    return locale === "tr" ? `${deltaMin} dk önce` : `${deltaMin}m ago`;
  }
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) {
    return locale === "tr" ? `${deltaHr} sa önce` : `${deltaHr}h ago`;
  }
  const deltaDay = Math.round(deltaHr / 24);
  return locale === "tr" ? `${deltaDay}g önce` : `${deltaDay}d ago`;
}

/** Re-export the cap so the bot index file or tests can read it. */
export { INLINE_RESULT_CAP };
