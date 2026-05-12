/**
 * D1 — bot inline-query handler (Phase 4).
 *
 * `@listbull_bot <query>` in any Telegram chat. Returns up to 10
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
  type InlineListRow,
  searchInlineItems,
  searchInlineLists,
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
  const query = inline.query ?? "";
  const [itemRows, listRows] = await Promise.all([
    searchInlineItems(user.id, query),
    searchInlineLists(user.id, query),
  ]);

  // Lists first (the user is more likely to want a whole list when the
  // query matches a list name precisely), items after — both capped
  // collectively at INLINE_RESULT_CAP*2 hard ceiling so Telegram's 50
  // result max stays clear.
  const listArticles: InlineQueryResultArticle[] = listRows.map((row) => {
    const result = mapListToInlineResult(row, locale);
    return {
      type: "article",
      id: `list:${result.id}`,
      title: result.title,
      description: result.description,
      input_message_content: {
        message_text: result.deeplink,
        link_preview_options: { is_disabled: false },
      },
    };
  });

  const itemArticles: InlineQueryResultArticle[] = itemRows.map((row) => {
    const result = mapRowToInlineResult(row, locale);
    return {
      type: "article",
      id: `item:${result.id}`,
      title: result.title,
      description: result.description,
      input_message_content: {
        message_text: result.deeplink,
        link_preview_options: { is_disabled: false },
      },
      ...(result.thumbUrl ? { thumb_url: result.thumbUrl } : {}),
    };
  });

  // Quick-create result — prepended when the query is non-empty so
  // the user can add an item to their active workspace's Inbox
  // without leaving the host chat. Selection fires
  // `chosen_inline_result` server-side (see handler in
  // chosen-inline-result.ts); the host-chat message is a tiny
  // confirmation card so the recipient sees what just happened.
  const trimmed = query.trim();
  const quickCreateArticles: InlineQueryResultArticle[] =
    trimmed.length > 0 && trimmed.length <= 200
      ? [
          {
            type: "article",
            // id is base64url(query) so the chosen_inline_result handler
            // can recover the exact text. Telegram caps id at 64 bytes.
            id: `create:${encodeIdPayload(trimmed)}`,
            title:
              locale === "tr"
                ? `➕ Inbox'a ekle: ${trimmed.slice(0, 50)}`
                : `➕ Add to Inbox: ${trimmed.slice(0, 50)}`,
            description:
              locale === "tr"
                ? "Aktif workspace'inin Inbox listesine yeni item"
                : "Add as a new item in your active workspace's Inbox",
            input_message_content: {
              message_text:
                locale === "tr"
                  ? `✓ Inbox'a eklendi: ${trimmed}`
                  : `✓ Added to Inbox: ${trimmed}`,
              link_preview_options: { is_disabled: true },
            },
          },
        ]
      : [];

  await ctx.answerInlineQuery(
    [...quickCreateArticles, ...listArticles, ...itemArticles],
    {
      cache_time: CACHE_SECONDS,
      is_personal: true,
    },
  );
}

/**
 * Pack a free-text query into a Telegram-safe inline-result id. We
 * base64url-encode + truncate to 60 bytes total (`create:` prefix +
 * payload), letting `chosen_inline_result` parse the original text
 * back out without ambiguity.
 */
function encodeIdPayload(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  // 60 - "create:".length = 53 raw bytes max; base64 ~= ceil(53/3)*4 = 72
  // chars which exceeds the 64-byte id ceiling. Truncate input bytes
  // so the encoded form fits.
  const MAX_RAW = 36; // 36 → base64 48 chars + "create:" = 55; safe.
  const truncated = bytes.subarray(0, MAX_RAW);
  return truncated.toString("base64url");
}

export function decodeIdPayload(b64: string): string {
  try {
    return Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Pure transform — list result mapper. Mirrors mapRowToInlineResult
 * for symmetric testability.
 */
export function mapListToInlineResult(
  row: InlineListRow,
  locale: "tr" | "en",
): InlineQueryResult {
  const emoji = row.listEmoji ?? "📋";
  const titleRaw = `${emoji} ${row.listName}`.replace(/\s+/g, " ").trim();
  const title = titleRaw.length > TITLE_MAX
    ? `${titleRaw.slice(0, TITLE_MAX - 1)}…`
    : titleRaw;

  const description =
    locale === "tr"
      ? `${row.openCount} açık öğe · liste`
      : `${row.openCount} open · list`;

  const startapp = `list_${row.listId}`;
  const deeplink = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=${startapp}`;

  return {
    id: row.listId,
    type: "article",
    title,
    description,
    deeplink,
  };
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
