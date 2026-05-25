/**
 * Sunday 21:00 (user-local) weekly digest.
 *
 * Per-user DM summary of the past week — closed count, still-open
 * count, overdue count, top 3 oldest open items, the chat they spent
 * most time in, and a consecutive-week-with-completions streak.
 *
 * Three render variants:
 *  - first-week welcome (user.created_at within the same week)
 *  - empty-week nudge (0 completed AND 0 currently open)
 *  - normal digest (everything else)
 *
 * Idempotency: `users.weekly_digest_sent_on` (date, user-local).
 * Stamped AFTER the sendMessage call — failures leave the stamp
 * null so the next 21:xx tick retries. Honors
 * `users.notifications_enabled`.
 *
 * Mirrors `daily-digest.ts` so the hour-top scheduler in
 * `dispatch-reminders.ts` has a consistent shape across both cron
 * jobs.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { getBot } from "@/lib/server/bot";
import { pickLocale } from "@/lib/server/bot/i18n";

const PICKUP_LIMIT = 500;
const TOP_OPEN_LIMIT = 3;
const STREAK_LOOKBACK_WEEKS = 12;

type DigestUser = {
  id: string;
  telegramId: number;
  firstName: string;
  locale: string;
  timezone: string;
  createdAt: Date;
};

type WeekStats = {
  completedThisWeek: number;
  currentlyOpen: number;
  overdue: number;
  oldestOpen: Array<{ text: string; daysOld: number }>;
  topChat: { title: string | null; type: string; messageCount: number } | null;
  streakWeeks: number;
  weekStart: Date;
  isFirstWeek: boolean;
};

async function pickEligibleUsers(): Promise<DigestUser[]> {
  // Pickup: notifications on, Sunday 21:00 in the user's timezone, no
  // stamp for today's user-local date yet. The `users_weekly_digest_pickup_idx`
  // partial index covers the WHERE — see schema.ts users() table.
  const rows = await db.execute<{
    id: string;
    telegram_id: number;
    telegram_first_name: string;
    locale: string;
    timezone: string;
    created_at: Date;
  }>(sql`
    SELECT u.id, u.telegram_id, u.telegram_first_name, u.locale, u.timezone,
           u.created_at
    FROM users u
    WHERE u.notifications_enabled = true
      AND EXTRACT(DOW FROM (NOW() AT TIME ZONE u.timezone))::int = 0
      AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.timezone))::int = 21
      AND (u.weekly_digest_sent_on IS NULL
        OR u.weekly_digest_sent_on <> (NOW() AT TIME ZONE u.timezone)::date)
    LIMIT ${PICKUP_LIMIT}
  `);
  return rows.map((r) => ({
    id: r.id,
    telegramId: r.telegram_id,
    firstName: r.telegram_first_name,
    locale: r.locale,
    timezone: r.timezone,
    createdAt: r.created_at,
  }));
}

async function computeStats(user: DigestUser): Promise<WeekStats> {
  // Week window: last 7 days, sliding. `weekStart` is captured for the
  // first-week detection — if `user.created_at >= weekStart` the user
  // signed up within this window and gets the welcome variant.
  const [counts, oldest, top, streak] = await Promise.all([
    db.execute<{
      completed: number;
      open: number;
      overdue: number;
    }>(sql`
      SELECT
        count(*) FILTER (
          WHERE i.completed_at IS NOT NULL
            AND i.completed_at >= NOW() - interval '7 days'
        )::int AS completed,
        count(*) FILTER (
          WHERE i.archived_at IS NULL AND i.is_done = false
        )::int AS open,
        count(*) FILTER (
          WHERE i.archived_at IS NULL
            AND i.is_done = false
            AND i.deadline_at IS NOT NULL
            AND i.deadline_at < NOW()
        )::int AS overdue
      FROM items i
      INNER JOIN chat_members cm
        ON cm.chat_id = i.chat_id AND cm.user_id = ${user.id}
    `),
    db.execute<{ text: string; days_old: number }>(sql`
      SELECT i.text,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - i.created_at)) / 86400)::int AS days_old
      FROM items i
      INNER JOIN chat_members cm
        ON cm.chat_id = i.chat_id AND cm.user_id = ${user.id}
      WHERE i.archived_at IS NULL
        AND i.is_done = false
        AND i.kind = 'todo'
      ORDER BY i.created_at ASC
      LIMIT ${TOP_OPEN_LIMIT}
    `),
    db.execute<{
      chat_id: number;
      title: string | null;
      type: string;
      msg_count: number;
    }>(sql`
      SELECT c.chat_id, c.title, c.type, count(m.id)::int AS msg_count
      FROM chats c
      INNER JOIN chat_members cm
        ON cm.chat_id = c.chat_id AND cm.user_id = ${user.id}
      LEFT JOIN messages m
        ON m.chat_id = c.chat_id
       AND m.user_id = ${user.id}
       AND m.created_at >= NOW() - interval '7 days'
      WHERE c.archived_at IS NULL
      GROUP BY c.chat_id
      HAVING count(m.id) > 0
      ORDER BY msg_count DESC
      LIMIT 1
    `),
    // Streak: count distinct ISO weeks in last 12 where the user has
    // ≥1 completion. Last-12-weeks bound keeps the scan cheap.
    db.execute<{ streak: number }>(sql`
      WITH week_marks AS (
        SELECT DISTINCT
          (i.completed_at AT TIME ZONE ${user.timezone})::date AS local_date
        FROM items i
        INNER JOIN chat_members cm
          ON cm.chat_id = i.chat_id AND cm.user_id = ${user.id}
        WHERE i.completed_at IS NOT NULL
          AND i.completed_at >= NOW() - (${STREAK_LOOKBACK_WEEKS}::int * interval '7 days')
      ),
      weekly AS (
        SELECT DISTINCT
          EXTRACT(WEEK FROM local_date)::int AS w,
          EXTRACT(ISOYEAR FROM local_date)::int AS y
        FROM week_marks
      )
      SELECT count(*)::int AS streak FROM weekly
    `),
  ]);

  const c = counts[0] ?? { completed: 0, open: 0, overdue: 0 };
  const s = streak[0] ?? { streak: 0 };
  const tc = top[0] ?? null;

  // Week start in user-local TZ — Monday 00:00. Used both for streak
  // copy and for first-week detection.
  const nowLocalRows = await db.execute<{ start: Date }>(sql`
    SELECT date_trunc('week', NOW() AT TIME ZONE ${user.timezone}) AS start
  `);
  const weekStart = nowLocalRows[0]?.start ?? new Date();

  return {
    completedThisWeek: c.completed,
    currentlyOpen: c.open,
    overdue: c.overdue,
    oldestOpen: oldest.map((r) => ({ text: r.text, daysOld: r.days_old })),
    topChat: tc
      ? { title: tc.title, type: tc.type, messageCount: tc.msg_count }
      : null,
    streakWeeks: s.streak,
    weekStart,
    // user.created_at within current local week → welcome variant
    isFirstWeek: user.createdAt >= weekStart,
  };
}

function renderDigest(user: DigestUser, stats: WeekStats): string {
  const locale = pickLocale(user.locale);
  const tr = locale === "tr";

  // First-week welcome — light touch, no "you accomplished N" copy
  // when there's barely been time to accomplish anything.
  if (stats.isFirstWeek) {
    return tr
      ? [
          `📊 İlk haftan tamamlandı, ${user.firstName}!`,
          "",
          stats.completedThisWeek > 0
            ? `Bu hafta ${stats.completedThisWeek} iş tamamladın 🎉`
            : "Daha hafta sonun var, kayma 🙂",
          "",
          "Sana 3 dakikalık bir tur lazımsa /onboarding yaz.",
          "İyi hafta sonu 👋",
        ].join("\n")
      : [
          `📊 First week wrapped, ${user.firstName}!`,
          "",
          stats.completedThisWeek > 0
            ? `You closed ${stats.completedThisWeek} item${stats.completedThisWeek === 1 ? "" : "s"} this week 🎉`
            : "Plenty of weekend left — still time to ship something 🙂",
          "",
          "Need a 3-minute tour? Just type /onboarding.",
          "Have a good rest of the weekend 👋",
        ].join("\n");
  }

  // Empty-week nudge — no completions AND nothing currently open.
  // Quiet user, gentle pull back in.
  if (stats.completedThisWeek === 0 && stats.currentlyOpen === 0) {
    return tr
      ? [
          `📊 Haftalık özet, ${user.firstName}`,
          "",
          "Bu hafta sessizdin — hiç açık iş kalmamış, yenisi de eklenmemiş.",
          "",
          "Hadi tek satırlık bir başlangıç:",
          "  • \"yarın 10:00'da fatura öde\"",
          "  • \"hafta sonu temizlik listesi: çamaşır, alışveriş, banyo\"",
          "",
          "Geri dönmek için bir mesaj yeter 👋",
        ].join("\n")
      : [
          `📊 Weekly digest, ${user.firstName}`,
          "",
          "Quiet week — nothing open, nothing closed.",
          "",
          "One-line nudge to come back:",
          "  • \"tomorrow 10am: pay the invoice\"",
          "  • \"weekend cleanup list: laundry, groceries, bathroom\"",
          "",
          "Just send a message when you're ready 👋",
        ].join("\n");
  }

  // Normal weekly digest.
  const lines: string[] = [];
  lines.push(tr ? `📊 Haftalık özet, ${user.firstName}` : `📊 Weekly digest, ${user.firstName}`);
  lines.push("");

  // Top-line scoreboard.
  const scoreParts: string[] = [];
  if (stats.completedThisWeek > 0) {
    scoreParts.push(
      tr
        ? `✅ ${stats.completedThisWeek} tamamlandı`
        : `✅ ${stats.completedThisWeek} closed`,
    );
  }
  if (stats.currentlyOpen > 0) {
    scoreParts.push(
      tr ? `📋 ${stats.currentlyOpen} açık` : `📋 ${stats.currentlyOpen} open`,
    );
  }
  if (stats.overdue > 0) {
    scoreParts.push(
      tr ? `⚠️ ${stats.overdue} gecikmiş` : `⚠️ ${stats.overdue} overdue`,
    );
  }
  if (scoreParts.length > 0) lines.push(scoreParts.join("  ·  "));

  // Streak — only show ≥2 consecutive weeks (1 is just "did something
  // this week"; not a streak yet).
  if (stats.streakWeeks >= 2) {
    lines.push("");
    lines.push(
      tr
        ? `🔥 Üst üste ${stats.streakWeeks} hafta tamamlama serindesin`
        : `🔥 ${stats.streakWeeks}-week completion streak`,
    );
  }

  // Top 3 oldest open — gentle nudge to clear stale work.
  if (stats.oldestOpen.length > 0) {
    lines.push("");
    lines.push(
      tr
        ? "🕰️ En eski açık işler:"
        : "🕰️ Oldest still open:",
    );
    for (const o of stats.oldestOpen) {
      const ago = tr ? `${o.daysOld} gündür` : `${o.daysOld}d`;
      // Cap text at ~80 chars so the line stays readable on mobile.
      const text = o.text.length > 80 ? o.text.slice(0, 77) + "…" : o.text;
      lines.push(`  • ${text} · ${ago}`);
    }
  }

  // Most-active chat.
  if (stats.topChat && stats.topChat.messageCount > 0) {
    lines.push("");
    const chatLabel = stats.topChat.title
      ? stats.topChat.title
      : tr
        ? "(özel sohbet)"
        : "(DM)";
    lines.push(
      tr
        ? `💬 En aktif: ${chatLabel} (${stats.topChat.messageCount} mesaj)`
        : `💬 Most active: ${chatLabel} (${stats.topChat.messageCount} msgs)`,
    );
  }

  lines.push("");
  lines.push(
    tr
      ? "İyi hafta sonu 👋"
      : "Have a good week ahead 👋",
  );

  return lines.join("\n");
}

export async function dispatchWeeklyDigest(): Promise<{
  picked: number;
  sent: number;
  failed: number;
}> {
  const picked = await pickEligibleUsers();
  if (picked.length === 0) return { picked: 0, sent: 0, failed: 0 };

  let bot;
  try {
    bot = await getBot();
  } catch (e) {
    console.error("[weekly-digest] bot init failed", e);
    return { picked: picked.length, sent: 0, failed: picked.length };
  }

  let sent = 0;
  let failed = 0;

  for (const user of picked) {
    try {
      const stats = await computeStats(user);
      const text = renderDigest(user, stats);
      await bot.api.sendMessage(user.telegramId, text);
      // Stamp AFTER successful send so a transient failure retries on
      // the next minute tick within the 21:xx window.
      await db.execute(sql`
        UPDATE users
           SET weekly_digest_sent_on = (NOW() AT TIME ZONE ${user.timezone})::date
         WHERE id = ${user.id}
      `);
      sent++;
    } catch (e) {
      console.error("[weekly-digest] send failed", {
        userId: user.id,
        err: String(e),
      });
      failed++;
    }
  }

  return { picked: picked.length, sent, failed };
}
