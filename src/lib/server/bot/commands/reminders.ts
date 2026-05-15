/**
 * /hatırlatıcılar (reminders) — pending reminders for the current chat.
 *
 * Shows reminders that haven't fired yet (`sent = false`), grouped by
 * item, ordered by next fire time. DM context gets the chat owner's
 * reminders; group context shows all members'.
 */
import type { Context } from "grammy";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { itemReminders, items } from "@/lib/db/schema";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleReminders(ctx: Context): Promise<void> {
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

  const rows = await db
    .select({
      reminderId: itemReminders.id,
      itemId: itemReminders.itemId,
      kind: itemReminders.kind,
      remindAt: itemReminders.remindAt,
      offsetMinutes: itemReminders.offsetMinutes,
      recurrenceRule: itemReminders.recurrenceRule,
      itemText: items.text,
      itemIsDone: items.isDone,
    })
    .from(itemReminders)
    .innerJoin(items, eq(items.id, itemReminders.itemId))
    .where(
      and(
        eq(items.chatId, chatId),
        isNull(items.archivedAt),
        eq(itemReminders.sent, false),
      ),
    )
    .orderBy(asc(itemReminders.remindAt))
    .limit(50);

  if (rows.length === 0) {
    await ctx.reply(
      locale === "tr"
        ? "🔔 Beklemede hatırlatıcı yok. ✨"
        : "🔔 No pending reminders. ✨",
    );
    return;
  }

  const lines: string[] = [
    locale === "tr"
      ? `🔔 Hatırlatıcılar (${rows.length})`
      : `🔔 Reminders (${rows.length})`,
    "",
  ];
  const dateFmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    timeZone: user.timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const kindIcon = r.kind === "before_deadline" ? "⏰" : "📍";
    const recur = r.recurrenceRule ? " 🔁" : "";
    const status = r.itemIsDone ? " ✅" : "";
    const offsetSuffix =
      r.kind === "before_deadline" && r.offsetMinutes !== null
        ? ` (${formatOffset(r.offsetMinutes, locale)} ${locale === "tr" ? "önce" : "before"})`
        : "";
    lines.push(
      `${i + 1}. ${kindIcon} ${dateFmt.format(r.remindAt)}${offsetSuffix}${recur}${status}`,
    );
    lines.push(`   ${r.itemText}`);
  }
  await ctx.reply(lines.join("\n"));
}

function formatOffset(minutes: number, locale: "tr" | "en"): string {
  if (minutes < 60) {
    return locale === "tr" ? `${minutes} dk` : `${minutes} min`;
  }
  if (minutes < 60 * 24) {
    const h = Math.round(minutes / 60);
    return locale === "tr" ? `${h} sa` : `${h} h`;
  }
  const d = Math.round(minutes / (60 * 24));
  return locale === "tr" ? `${d} gün` : `${d} d`;
}
