/**
 * /atanan (assigned) — items assigned to a specific chat member.
 *
 * Usage:
 *   /atanan          → items assigned to the caller
 *   /atanan @ali     → items assigned to @ali (chat-member only)
 *
 * Plain-text render; uses the inline-keyboard /items view for editing.
 */
import type { Context } from "grammy";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items } from "@/lib/db/schema";
import { findChatMemberByUsername } from "@/lib/db/queries/chats";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleAssigned(ctx: Context): Promise<void> {
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

  // Parse "/atanan @ali" or "/atanan ali" — match.text after the command.
  const matchText =
    "text" in message && typeof message.text === "string"
      ? message.text.trim()
      : "";
  const arg = matchText.replace(/^\/\S+/, "").trim();

  let target: { userId: string; label: string };
  if (arg.length > 0) {
    const found = await findChatMemberByUsername(chatId, arg);
    if (!found) {
      await ctx.reply(
        locale === "tr"
          ? `🤷 "${arg}" bu chat'in üyesi değil. /atanan @kullaniciadi gibi yaz.`
          : `🤷 "${arg}" is not a member of this chat. Try /atanan @username.`,
      );
      return;
    }
    target = {
      userId: found.userId,
      label: found.telegramUsername
        ? `@${found.telegramUsername}`
        : found.telegramFirstName,
    };
  } else {
    target = {
      userId: user.id,
      label: user.telegramUsername
        ? `@${user.telegramUsername}`
        : user.telegramFirstName,
    };
  }

  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        isNull(items.archivedAt),
        eq(items.isDone, false),
        eq(items.assigneeId, target.userId),
      ),
    )
    .orderBy(asc(items.deadlineAt), asc(items.position));

  if (rows.length === 0) {
    await ctx.reply(
      locale === "tr"
        ? `👤 ${target.label}'a atanan açık iş yok. ✨`
        : `👤 No open items assigned to ${target.label}. ✨`,
    );
    return;
  }

  const lines: string[] = [
    locale === "tr"
      ? `👤 ${target.label} — atanan (${rows.length})`
      : `👤 ${target.label} — assigned (${rows.length})`,
    "",
  ];
  const dateFmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    timeZone: user.timezone,
    day: "numeric",
    month: "short",
  });
  for (let i = 0; i < rows.length; i++) {
    const it = rows[i]!;
    const priority = it.priority === "high" ? "🔥 " : "";
    const deadline = it.deadlineAt
      ? ` — ${markerForDeadline(it.deadlineAt)} ${dateFmt.format(it.deadlineAt)}`
      : "";
    lines.push(`${i + 1}. ${priority}${it.text}${deadline}`);
  }
  await ctx.reply(lines.join("\n"));
}

function markerForDeadline(d: Date): string {
  const diff = d.getTime() - Date.now();
  if (diff < 0) return "⚠️";
  if (diff < 24 * 60 * 60 * 1000) return "⏳";
  return "📅";
}
