/**
 * 09:00-local daily digest (Phase 17 chat-only).
 *
 * Sends a per-user DM summary of items due today + overdue across
 * every chat they own or are a member of. Skips empty days.
 */
import "server-only";

import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chatMembers, items, users } from "@/lib/db/schema";
import { getBot } from "@/lib/server/bot";
import { pickLocale } from "@/lib/server/bot/i18n";

const PICKUP_LIMIT = 500;

type DigestUser = {
  id: string;
  telegramId: number;
  firstName: string;
  locale: string;
  timezone: string;
};

async function pickEligibleUsers(): Promise<DigestUser[]> {
  const rows = await db.execute<{
    id: string;
    telegram_id: number;
    telegram_first_name: string;
    locale: string;
    timezone: string;
  }>(sql`
    SELECT u.id, u.telegram_id, u.telegram_first_name, u.locale, u.timezone
    FROM users u
    WHERE u.notifications_enabled = true
      AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.timezone))::int = 9
      AND (u.daily_digest_sent_on IS NULL
        OR u.daily_digest_sent_on <> (NOW() AT TIME ZONE u.timezone)::date)
    LIMIT ${PICKUP_LIMIT}
  `);
  return rows.map((r) => ({
    id: r.id,
    telegramId: r.telegram_id,
    firstName: r.telegram_first_name,
    locale: r.locale,
    timezone: r.timezone,
  }));
}

async function renderUserDigest(user: DigestUser): Promise<string | null> {
  // Items due today OR overdue ≤7 days, in chats the user belongs to.
  const rows = await db.execute<{
    text: string;
    deadline_at: Date | null;
    is_overdue: boolean;
  }>(sql`
    WITH bounds AS (
      SELECT
        (NOW() AT TIME ZONE ${user.timezone})::date AS today,
        ((NOW() AT TIME ZONE ${user.timezone})::date + interval '1 day') AS tomorrow,
        ((NOW() AT TIME ZONE ${user.timezone})::date - interval '7 days') AS weekago
    )
    SELECT
      i.text,
      i.deadline_at,
      (i.deadline_at < (SELECT (NOW() AT TIME ZONE ${user.timezone})::timestamp FROM bounds LIMIT 1)) AS is_overdue
    FROM ${items} i
    INNER JOIN ${chatMembers} cm ON cm.chat_id = i.chat_id AND cm.user_id = ${user.id}
    WHERE i.archived_at IS NULL
      AND i.is_done = false
      AND i.deadline_at IS NOT NULL
      AND i.deadline_at >= (SELECT ((weekago AT TIME ZONE ${user.timezone})) FROM bounds)
      AND i.deadline_at < (SELECT ((tomorrow AT TIME ZONE ${user.timezone})) FROM bounds)
    ORDER BY i.deadline_at ASC
    LIMIT 30
  `);

  if (rows.length === 0) return null;

  const locale = pickLocale(user.locale);
  const lines: string[] = [
    locale === "tr"
      ? `📅 Günaydın ${user.firstName}!`
      : `📅 Good morning ${user.firstName}!`,
    "",
  ];
  type Row = { text: string; deadline_at: Date | null; is_overdue: boolean };
  const dueToday: Row[] = [];
  const overdue: Row[] = [];
  for (const r of rows) {
    if (r.is_overdue) overdue.push(r);
    else dueToday.push(r);
  }
  if (dueToday.length > 0) {
    lines.push(
      locale === "tr"
        ? `⏰ Bugün son tarih (${dueToday.length})`
        : `⏰ Due today (${dueToday.length})`,
    );
    for (const r of dueToday.slice(0, 15)) {
      lines.push(`  • ${r.text}`);
    }
    if (dueToday.length > 15) {
      lines.push(`  … +${dueToday.length - 15}`);
    }
  }
  if (overdue.length > 0) {
    lines.push("");
    lines.push(
      locale === "tr"
        ? `⚠️ Geciken (${overdue.length})`
        : `⚠️ Overdue (${overdue.length})`,
    );
    for (const r of overdue.slice(0, 15)) {
      lines.push(`  • ${r.text}`);
    }
    if (overdue.length > 15) {
      lines.push(`  … +${overdue.length - 15}`);
    }
  }
  return lines.join("\n");
}

export async function dispatchDailyDigest(): Promise<{
  picked: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const picked = await pickEligibleUsers();
  if (picked.length === 0) {
    return { picked: 0, sent: 0, skipped: 0, failed: 0 };
  }

  let bot;
  try {
    bot = await getBot();
  } catch (e) {
    console.error("[daily-digest] bot init failed", e);
    return { picked: picked.length, sent: 0, skipped: 0, failed: picked.length };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of picked) {
    try {
      const text = await renderUserDigest(user);
      // Stamp regardless to avoid retries during the 09:xx window.
      await db.execute(sql`
        UPDATE users
           SET daily_digest_sent_on = (NOW() AT TIME ZONE ${user.timezone})::date
         WHERE id = ${user.id}
      `);
      if (!text) {
        skipped++;
        continue;
      }
      await bot.api.sendMessage(user.telegramId, text);
      sent++;
    } catch (e) {
      console.error("[daily-digest] send failed", {
        userId: user.id,
        err: String(e),
      });
      failed++;
    }
  }

  // silence unused imports if branches change later
  void and;
  void eq;
  void gte;
  void isNull;
  void lt;
  return { picked: picked.length, sent, skipped, failed };
}
