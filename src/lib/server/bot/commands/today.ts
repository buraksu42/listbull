/**
 * /bugün — items with deadline in the user-local "today" window
 * (Phase 17). Plain text render; for tap-to-toggle UX use /items.
 */
import type { Context } from "grammy";
import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items } from "@/lib/db/schema";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleToday(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);
  const chatId = message.chat.id;

  // Window: [local today 00:00, local tomorrow 00:00) — Postgres-side
  // so DST + timezone math is handled by the DB, not JS.
  const { startUtc, endUtc } = await computeLocalDayBounds(user.timezone, 0, 1);
  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        isNull(items.archivedAt),
        eq(items.isDone, false),
        gte(items.deadlineAt, startUtc),
        lt(items.deadlineAt, endUtc),
      ),
    )
    .orderBy(asc(items.deadlineAt), asc(items.position));

  if (rows.length === 0) {
    await ctx.reply(
      locale === "tr"
        ? "📅 Bugün için açık iş yok. ✨"
        : "📅 Nothing on the agenda today. ✨",
    );
    return;
  }

  const lines: string[] = [
    locale === "tr" ? `📅 Bugün (${rows.length})` : `📅 Today (${rows.length})`,
    "",
  ];
  for (let i = 0; i < rows.length; i++) {
    const it = rows[i]!;
    const priority = it.priority === "high" ? "🔥 " : "";
    lines.push(`${i + 1}. ${priority}${it.text}`);
  }
  await ctx.reply(lines.join("\n"));
}

async function computeLocalDayBounds(
  timezone: string,
  dayOffset: number,
  dayCount: number,
): Promise<{ startUtc: Date; endUtc: Date }> {
  // postgres-js returns raw timestamptz values as strings; Drizzle's
  // gte()/lt() helpers expect a Date and call .toISOString() during
  // query build, which would throw on the string. Coerce here.
  const rows = await db.execute<{ start_utc: string | Date; end_utc: string | Date }>(sql`
    SELECT
      (((NOW() AT TIME ZONE ${timezone})::date + ${dayOffset} * interval '1 day') AT TIME ZONE ${timezone}) AS start_utc,
      (((NOW() AT TIME ZONE ${timezone})::date + ${dayOffset + dayCount} * interval '1 day') AT TIME ZONE ${timezone}) AS end_utc
  `);
  const row = rows[0];
  if (!row) throw new Error("computeLocalDayBounds: no row");
  return {
    startUtc: row.start_utc instanceof Date ? row.start_utc : new Date(row.start_utc),
    endUtc: row.end_utc instanceof Date ? row.end_utc : new Date(row.end_utc),
  };
}

export async function handleWeek(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;
  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);
  const chatId = message.chat.id;

  const { startUtc, endUtc } = await computeLocalDayBounds(user.timezone, 0, 7);
  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        isNull(items.archivedAt),
        eq(items.isDone, false),
        gte(items.deadlineAt, startUtc),
        lt(items.deadlineAt, endUtc),
      ),
    )
    .orderBy(asc(items.deadlineAt), asc(items.position));

  if (rows.length === 0) {
    await ctx.reply(
      locale === "tr"
        ? "🗓 Bu hafta için açık iş yok. ✨"
        : "🗓 Nothing scheduled this week. ✨",
    );
    return;
  }

  const lines: string[] = [
    locale === "tr"
      ? `🗓 Bu hafta (${rows.length})`
      : `🗓 This week (${rows.length})`,
    "",
  ];
  let lastDay = "";
  const fmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    timeZone: user.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeFmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    timeZone: user.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  for (const it of rows) {
    const dayKey = it.deadlineAt ? fmt.format(it.deadlineAt) : "";
    if (dayKey !== lastDay) {
      lines.push("");
      lines.push(`📌 ${dayKey}`);
      lastDay = dayKey;
    }
    const priority = it.priority === "high" ? "🔥 " : "";
    const time =
      it.deadlineAt && timeFmt.format(it.deadlineAt) !== "00:00"
        ? ` ${timeFmt.format(it.deadlineAt)}`
        : "";
    lines.push(`  • ${priority}${it.text}${time}`);
  }
  await ctx.reply(lines.join("\n"));
}
