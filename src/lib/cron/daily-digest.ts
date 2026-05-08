/**
 * Phase 15: 09:00 daily digest.
 *
 * Run from the same Dokploy cron container as `dispatch-reminders`,
 * but only at the top of each UTC hour (parent loop checks
 * `now.getUTCMinutes() < 1`). The pickup query then filters down to
 * users where the local-timezone hour is currently 9 — so a Tokyo
 * user gets pinged at their 09:00 (UTC 00:00) and an Istanbul user
 * gets pinged at their 09:00 (UTC 06:00 winter / 06:00 summer since
 * Turkey has no DST).
 *
 * Idempotency: `users.daily_digest_sent_on` stores the user-local
 * date of the last successful send. The pickup predicate excludes
 * users whose marker already equals today (in their timezone).
 *
 * Send target: ALWAYS the default platform bot. Per-workspace white-
 * label bots are reminder-scoped (Phase 5); the digest is a user-
 * level surface and we don't want to fan it out across multiple
 * bots the user may have started independently.
 *
 * Empty days: when a user has zero items in scope, we SKIP the send
 * entirely. Daily "you have nothing today" pings are noise — they'd
 * train users to mute the bot.
 */
import "server-only";

import { and, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists } from "@/lib/db/schema";
import { getBot } from "@/lib/server/bot";
import { escapeMarkdownV2 } from "@/lib/server/bot/escape-markdown";
import { pickLocale } from "@/lib/server/bot/i18n";
import { formatDate } from "@/lib/utils/format-date";
import type {
  AllowedDateFormat,
  AllowedTimeFormat,
} from "@/lib/validators/settings";

const PICKUP_LIMIT = 500;
/** Telegram caps outbound messages at 4096 chars. */
const TG_MAX = 4096;
/** Cap items per section to keep messages skimmable + below TG cap. */
const SECTION_LIMIT = 20;
/** How far back to surface overdue items (rolling). */
const OVERDUE_WINDOW_DAYS = 7;

type DigestUser = {
  id: string;
  telegramId: number;
  firstName: string;
  locale: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
};

type DigestItem = {
  id: string;
  text: string;
  deadlineAt: Date | null;
  listId: string;
  listName: string;
  listEmoji: string | null;
};

export async function dispatchDailyDigest(): Promise<{
  picked: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const userRows = await pickEligibleUsers();
  if (userRows.length === 0) {
    return { picked: 0, sent: 0, skipped: 0, failed: 0 };
  }

  let bot;
  try {
    bot = await getBot();
  } catch (e) {
    console.error("[daily-digest] bot init failed", e);
    return {
      picked: userRows.length,
      sent: 0,
      skipped: 0,
      failed: userRows.length,
    };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const u of userRows) {
    try {
      const today = await listTodayItems(u);
      const overdue = await listOverdueItems(u);
      if (today.length === 0 && overdue.length === 0) {
        // Empty day → still mark sent so we don't keep evaluating
        // every cron tick for the rest of today. Cheap UPDATE.
        await markSent(u);
        skipped += 1;
        continue;
      }
      const body = formatDigestBody({ user: u, today, overdue });
      await bot.api.sendMessage(u.telegramId, body, {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      });
      await markSent(u);
      sent += 1;
    } catch (e) {
      console.error("[daily-digest] per-user failure", {
        userId: u.id,
        error: String(e),
      });
      failed += 1;
    }
  }

  return { picked: userRows.length, sent, skipped, failed };
}

/**
 * Pick users whose local hour is currently 9 AND who haven't received
 * a digest yet today (in their timezone). Returns at most
 * `PICKUP_LIMIT` rows; in practice this stays well under the cap
 * because only a tiny window of users is in their 9 AM at any given
 * UTC hour.
 */
async function pickEligibleUsers(): Promise<DigestUser[]> {
  const rows = await db.execute(sql`
    select
      u.id,
      u.telegram_id,
      u.telegram_first_name,
      u.locale,
      u.timezone,
      u.date_format,
      u.time_format
    from users u
    where u.notifications_enabled = true
      and extract(hour from (now() at time zone u.timezone)) = 9
      and (
        u.daily_digest_sent_on is null
        or u.daily_digest_sent_on < (now() at time zone u.timezone)::date
      )
    limit ${PICKUP_LIMIT}
  `);

  // drizzle's execute returns a result with `rows` for raw SELECTs.
  // The exact field path differs across drivers; cast loosely + map.
  const list =
    (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (rows as unknown as Array<Record<string, unknown>>) ??
    [];
  return list
    .map((r): DigestUser | null => {
      const id = r.id;
      const tgId = r.telegram_id;
      if (typeof id !== "string" || tgId == null) return null;
      const tgIdNum =
        typeof tgId === "number"
          ? tgId
          : typeof tgId === "string"
            ? Number.parseInt(tgId, 10)
            : Number(tgId);
      if (!Number.isFinite(tgIdNum)) return null;
      return {
        id,
        telegramId: tgIdNum,
        firstName: typeof r.telegram_first_name === "string" ? r.telegram_first_name : "",
        locale: typeof r.locale === "string" ? r.locale : "en",
        timezone: typeof r.timezone === "string" ? r.timezone : "UTC",
        dateFormat:
          typeof r.date_format === "string" ? r.date_format : "DD.MM.YYYY",
        timeFormat:
          typeof r.time_format === "string" ? r.time_format : "24h",
      };
    })
    .filter((x): x is DigestUser => x !== null);
}

/**
 * Items in any list the user is a member of, with deadline_at in the
 * next 24h. Done items + archived items are excluded.
 */
async function listTodayItems(u: DigestUser): Promise<DigestItem[]> {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: items.id,
      text: items.text,
      deadlineAt: items.deadlineAt,
      listId: items.listId,
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, u.id),
        isNull(items.archivedAt),
        isNull(lists.archivedAt),
        eq(items.isDone, false),
        // deadline_at >= now AND deadline_at <= now + 24h
        gt(items.deadlineAt, now),
        lte(items.deadlineAt, tomorrow),
      ),
    )
    .orderBy(items.deadlineAt)
    .limit(SECTION_LIMIT + 1); // +1 to detect overflow
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    deadlineAt: r.deadlineAt,
    listId: r.listId,
    listName: r.listName,
    listEmoji: r.listEmoji,
  }));
}

/**
 * Items overdue within the rolling 7-day window. Older overdue items
 * are intentionally hidden — they're noise, not actionable from a
 * morning digest. The user can browse the full backlog in the Mini
 * App's today view.
 */
async function listOverdueItems(u: DigestUser): Promise<DigestItem[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() - OVERDUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: items.id,
      text: items.text,
      deadlineAt: items.deadlineAt,
      listId: items.listId,
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, u.id),
        isNull(items.archivedAt),
        isNull(lists.archivedAt),
        eq(items.isDone, false),
        lt(items.deadlineAt, now),
        // deadline_at >= now - 7d (skip ancient overdue noise)
        gt(items.deadlineAt, horizon),
      ),
    )
    .orderBy(items.deadlineAt)
    .limit(SECTION_LIMIT + 1);
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    deadlineAt: r.deadlineAt,
    listId: r.listId,
    listName: r.listName,
    listEmoji: r.listEmoji,
  }));
}

function formatDigestBody(args: {
  user: DigestUser;
  today: DigestItem[];
  overdue: DigestItem[];
}): string {
  const { user, today, overdue } = args;
  const locale = pickLocale(user.locale);
  const dateFormat = user.dateFormat as AllowedDateFormat;
  const timeFormat = user.timeFormat as AllowedTimeFormat;
  const tz = user.timezone || "UTC";

  const lines: string[] = [];
  const greeting =
    locale === "tr"
      ? `🌞 *Günaydın ${escapeMarkdownV2(user.firstName || "")}*`
      : `🌞 *Good morning ${escapeMarkdownV2(user.firstName || "")}*`;
  lines.push(greeting.trimEnd());
  lines.push("");

  if (today.length > 0) {
    lines.push(locale === "tr" ? "*Bugün:*" : "*Today:*");
    const visible = today.slice(0, SECTION_LIMIT);
    for (const it of visible) {
      const tStr = it.deadlineAt
        ? formatDate(it.deadlineAt.toISOString(), {
            locale,
            timezone: tz,
            dateFormat,
            timeFormat,
            show: "time",
          })
        : "";
      const listLabel = `${it.listEmoji ?? "📋"} ${it.listName}`;
      lines.push(
        `• ${escapeMarkdownV2(tStr)} — ${escapeMarkdownV2(it.text)} _${escapeMarkdownV2(listLabel)}_`,
      );
    }
    if (today.length > SECTION_LIMIT) {
      const more = today.length - SECTION_LIMIT;
      lines.push(
        locale === "tr"
          ? `…ve ${more} madde daha`
          : `…and ${more} more`,
      );
    }
    lines.push("");
  }

  if (overdue.length > 0) {
    lines.push(
      locale === "tr"
        ? `*Geciken \\(${overdue.length}\\):*`
        : `*Overdue \\(${overdue.length}\\):*`,
    );
    const visible = overdue.slice(0, SECTION_LIMIT);
    for (const it of visible) {
      const dStr = it.deadlineAt
        ? formatDate(it.deadlineAt.toISOString(), {
            locale,
            timezone: tz,
            dateFormat,
            timeFormat,
            show: "date",
          })
        : "";
      const listLabel = `${it.listEmoji ?? "📋"} ${it.listName}`;
      lines.push(
        `• ${escapeMarkdownV2(dStr)} — ${escapeMarkdownV2(it.text)} _${escapeMarkdownV2(listLabel)}_`,
      );
    }
    if (overdue.length > SECTION_LIMIT) {
      const more = overdue.length - SECTION_LIMIT;
      lines.push(
        locale === "tr"
          ? `…ve ${more} madde daha`
          : `…and ${more} more`,
      );
    }
  }

  let body = lines.join("\n");
  // Defensive: if a user somehow has dozens of items + huge text, cap
  // the body at TG_MAX-1 so we never trip the 4096 limit. The
  // SECTION_LIMIT loop above already caps the line count, but Markdown
  // escape can balloon length on certain inputs.
  if (body.length > TG_MAX) {
    body = `${body.slice(0, TG_MAX - 4)}…`;
  }
  return body;
}

async function markSent(u: DigestUser): Promise<void> {
  // Compute "today in user's timezone" via Postgres so timezone math
  // matches the pickup predicate exactly (no JS Date drift).
  await db.execute(sql`
    update users
       set daily_digest_sent_on = (now() at time zone ${u.timezone})::date,
           updated_at = now()
     where id = ${u.id}
  `);
}

// or import is referenced for symmetry with item queries elsewhere.
void or;
