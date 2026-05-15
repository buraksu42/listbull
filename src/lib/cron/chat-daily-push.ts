/**
 * Per-chat 09:00-owner-local daily push (Phase 17).
 *
 * For each chat where owner-local hour == 9 AND last_daily_push_on
 * is not today (owner-TZ): aggregate today's items, render, send to
 * chat_id, stamp last_daily_push_on. Empty digests get the stamp but
 * no send (no noise).
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chats, items, users } from "@/lib/db/schema";
import { getBot } from "@/lib/server/bot";
import { pickLocale } from "@/lib/server/bot/i18n";

const PICKUP_LIMIT = 100;

type DuePush = {
  chatId: number;
  title: string | null;
  ownerLocale: string;
  ownerTimezone: string;
};

export async function dispatchChatDailyPush(): Promise<{
  picked: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const rows = await db.execute<{
    chat_id: number;
    title: string | null;
    owner_locale: string;
    owner_timezone: string;
  }>(sql`
    SELECT c.chat_id, c.title, u.locale AS owner_locale, u.timezone AS owner_timezone
    FROM ${chats} c
    INNER JOIN ${users} u ON u.id = c.owner_user_id
    WHERE c.archived_at IS NULL
      AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.timezone))::int = 9
      AND (c.last_daily_push_on IS NULL
        OR c.last_daily_push_on <> (NOW() AT TIME ZONE u.timezone)::date)
    LIMIT ${PICKUP_LIMIT}
  `);

  const due: DuePush[] = rows.map((r) => ({
    chatId: r.chat_id,
    title: r.title,
    ownerLocale: r.owner_locale,
    ownerTimezone: r.owner_timezone,
  }));

  if (due.length === 0) {
    return { picked: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const bot = await getBot();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const chat of due) {
    try {
      const itemRows = await db.execute<{
        text: string;
        deadline_at: Date | null;
      }>(sql`
        WITH bounds AS (
          SELECT
            (NOW() AT TIME ZONE ${chat.ownerTimezone})::date AS today,
            ((NOW() AT TIME ZONE ${chat.ownerTimezone})::date + interval '1 day') AS tomorrow,
            ((NOW() AT TIME ZONE ${chat.ownerTimezone})::date - interval '7 days') AS weekago
        )
        SELECT i.text, i.deadline_at
        FROM ${items} i
        WHERE i.chat_id = ${chat.chatId}
          AND i.archived_at IS NULL
          AND i.is_done = false
          AND i.deadline_at IS NOT NULL
          AND i.deadline_at >= (SELECT ((weekago AT TIME ZONE ${chat.ownerTimezone})) FROM bounds)
          AND i.deadline_at < (SELECT ((tomorrow AT TIME ZONE ${chat.ownerTimezone})) FROM bounds)
        ORDER BY i.deadline_at ASC
        LIMIT 20
      `);

      await db.execute(sql`
        UPDATE chats
           SET last_daily_push_on = (NOW() AT TIME ZONE ${chat.ownerTimezone})::date
         WHERE chat_id = ${chat.chatId}
      `);

      if (itemRows.length === 0) {
        skipped++;
        continue;
      }
      const locale = pickLocale(chat.ownerLocale);
      const lines: string[] = [
        locale === "tr"
          ? `📅 Bugün — ${chat.title ?? "bu chat"}`
          : `📅 Today — ${chat.title ?? "this chat"}`,
        "",
      ];
      for (const r of itemRows) {
        lines.push(`• ${r.text}`);
      }
      await bot.api.sendMessage(chat.chatId, lines.join("\n"));
      sent++;
    } catch (e) {
      console.error("[chat-daily-push] failed", {
        chatId: chat.chatId,
        err: String(e),
      });
      failed++;
    }
  }

  return { picked: due.length, sent, skipped, failed };
}
