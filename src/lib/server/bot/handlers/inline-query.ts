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
  type InlineListPreview,
  type InlineListRow,
  type InlineSearchRow,
  searchInlineByAssignee,
  searchInlineByTag,
  searchInlineItems,
  searchInlineListPreviews,
  searchInlineLists,
  searchInlineToday,
  searchInlineWeek,
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

  // List-share short-circuit: `@bot :listname` → rich preview cards
  // for matching lists (up to 5), each with first 5 items inline so
  // the user can forward a list snapshot to another chat without
  // leaving the picker.
  const shareTarget = parseListSharePrefix(query);
  if (shareTarget !== null) {
    const previews = await searchInlineListPreviews(user.id, shareTarget);
    const cards = previews.map((p) =>
      buildListSharePreviewCard(p, locale),
    );
    await ctx.answerInlineQuery(cards, {
      cache_time: CACHE_SECONDS,
      is_personal: true,
    });
    return;
  }

  // Smart-query short-circuit: recognized prefixes route to filtered
  // queries instead of the plain ILIKE search. The summary card
  // describes what the filter matched; rest of the cards are the
  // matching items. List search is skipped — these prefixes are
  // semantic, "matching list names" wouldn't make sense.
  const smart = parseSmartQuery(query);
  if (smart) {
    const matched = await runSmartQuery(smart, user.id, user.timezone);
    const summary = buildSmartSummaryCard(smart, matched.length, locale);
    const itemArticles = matched.map((row) => {
      const result = mapRowToInlineResult(row, locale);
      return {
        type: "article" as const,
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
    await ctx.answerInlineQuery([summary, ...itemArticles], {
      cache_time: CACHE_SECONDS,
      is_personal: true,
    });
    return;
  }

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

// ─── List-share plumbing (Phase 16/inline-B) ─────────────────────────

/**
 * `@bot :foo` activates list-share mode and the rest of the query is
 * fed to `searchInlineListPreviews`. `:` alone surfaces the user's
 * most-recent lists (so a "share without remembering the name" tap
 * still works). Returns the search fragment, or null when the query
 * isn't a list-share invocation.
 */
export function parseListSharePrefix(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(":")) return null;
  return trimmed.slice(1).trim();
}

function buildListSharePreviewCard(
  preview: InlineListPreview,
  locale: "tr" | "en",
): InlineQueryResultArticle {
  const emoji = preview.listEmoji ?? "📋";
  const titleRaw = `${emoji} ${preview.listName}`.replace(/\s+/g, " ").trim();
  const title = titleRaw.length > TITLE_MAX
    ? `${titleRaw.slice(0, TITLE_MAX - 1)}…`
    : titleRaw;
  const description =
    locale === "tr"
      ? `${preview.openCount} açık öğe · liste'yi paylaş`
      : `${preview.openCount} open · share this list`;

  // Inserted message body: list header + first 5 items + deeplink to
  // the full list in the Mini App.
  const lines: string[] = [
    `${emoji} ${preview.listName} (${preview.openCount} ${locale === "tr" ? "açık" : "open"})`,
    "",
  ];
  for (const itemText of preview.previewItems) {
    const truncated =
      itemText.length > 60 ? `${itemText.slice(0, 60)}…` : itemText;
    lines.push(`• ${truncated}`);
  }
  if (preview.openCount > preview.previewItems.length) {
    lines.push(
      locale === "tr"
        ? `… ve ${preview.openCount - preview.previewItems.length} daha`
        : `… and ${preview.openCount - preview.previewItems.length} more`,
    );
  }
  lines.push("");
  const startapp = `list_${preview.listId}`;
  const deeplink = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=${startapp}`;
  lines.push(
    locale === "tr"
      ? `📲 Tümünü gör: ${deeplink}`
      : `📲 See all: ${deeplink}`,
  );

  return {
    type: "article",
    id: `share:${preview.listId}`,
    title,
    description,
    input_message_content: {
      message_text: lines.join("\n"),
      link_preview_options: { is_disabled: true },
    },
  };
}

// ─── Smart-query plumbing (Phase 16/inline-C) ────────────────────────

type SmartQuery =
  | { kind: "today" }
  | { kind: "week" }
  | { kind: "assignee"; username: string }
  | { kind: "tag"; tag: string };

/**
 * Recognize a smart-query prefix. Returns null when the query is a
 * plain text search. Matching is case-insensitive and forgiving — we
 * accept "bugün", "today", "BUGÜN" all the same.
 */
export function parseSmartQuery(raw: string): SmartQuery | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const lower = trimmed.toLowerCase();
  if (lower === "bugün" || lower === "bugun" || lower === "today") {
    return { kind: "today" };
  }
  if (
    lower === "hafta" ||
    lower === "bu hafta" ||
    lower === "week" ||
    lower === "this week"
  ) {
    return { kind: "week" };
  }

  if (trimmed.startsWith("@")) {
    const username = trimmed.slice(1).split(/\s+/)[0] ?? "";
    if (username.length === 0) return null;
    return { kind: "assignee", username };
  }

  if (trimmed.startsWith("#")) {
    const tag = trimmed.slice(1).split(/\s+/)[0] ?? "";
    if (tag.length === 0) return null;
    return { kind: "tag", tag };
  }

  return null;
}

async function runSmartQuery(
  q: SmartQuery,
  userId: string,
  timezone: string,
): Promise<InlineSearchRow[]> {
  switch (q.kind) {
    case "today":
      return searchInlineToday(userId, timezone);
    case "week":
      return searchInlineWeek(userId, timezone);
    case "assignee":
      return searchInlineByAssignee(userId, q.username);
    case "tag":
      return searchInlineByTag(userId, q.tag);
  }
}

/**
 * The first card in a smart-query result describes what the filter
 * matched ("📅 Bugün için 3 item"). Tapping the summary inserts a
 * deeplink to the matching Mini App view (today/week) or, for
 * assignee/tag, a textual summary the user can paste.
 */
function buildSmartSummaryCard(
  q: SmartQuery,
  matchCount: number,
  locale: "tr" | "en",
): InlineQueryResultArticle {
  let icon: string;
  let title: string;
  let description: string;
  let messageText: string;

  const botUsername = env.TELEGRAM_BOT_USERNAME;

  switch (q.kind) {
    case "today": {
      icon = "📅";
      title =
        locale === "tr"
          ? `${icon} Bugün — ${matchCount} item`
          : `${icon} Today — ${matchCount} items`;
      description =
        locale === "tr"
          ? "Mini App'te bugünün görünümünü aç"
          : "Open today's view in the Mini App";
      messageText = `https://t.me/${botUsername}?startapp=view_today`;
      break;
    }
    case "week": {
      icon = "🗓";
      title =
        locale === "tr"
          ? `${icon} Bu hafta — ${matchCount} item`
          : `${icon} This week — ${matchCount} items`;
      description =
        locale === "tr"
          ? "Mini App'te haftanın görünümünü aç"
          : "Open this week's view in the Mini App";
      messageText = `https://t.me/${botUsername}?startapp=view_week`;
      break;
    }
    case "assignee": {
      icon = "👤";
      title =
        locale === "tr"
          ? `${icon} @${q.username} — ${matchCount} açık item`
          : `${icon} @${q.username} — ${matchCount} open items`;
      description =
        locale === "tr"
          ? "Bu kullanıcıya atanmış işler"
          : "Items assigned to this user";
      messageText =
        locale === "tr"
          ? `@${q.username} — ${matchCount} açık item (listbull)`
          : `@${q.username} — ${matchCount} open items (listbull)`;
      break;
    }
    case "tag": {
      icon = "🏷";
      title =
        locale === "tr"
          ? `${icon} #${q.tag} — ${matchCount} açık item`
          : `${icon} #${q.tag} — ${matchCount} open items`;
      description =
        locale === "tr"
          ? "Bu etiketli açık işler"
          : "Open items with this tag";
      messageText =
        locale === "tr"
          ? `#${q.tag} — ${matchCount} açık item (listbull)`
          : `#${q.tag} — ${matchCount} open items (listbull)`;
      break;
    }
  }

  return {
    type: "article",
    id: `smart:${q.kind}:${matchCount}`,
    title,
    description,
    input_message_content: {
      message_text: messageText,
      link_preview_options: { is_disabled: q.kind === "assignee" || q.kind === "tag" },
    },
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
