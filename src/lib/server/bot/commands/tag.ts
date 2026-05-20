/**
 * /tag <name> — list open todos carrying a given tag.
 *
 * Tags double as the person-assignment primitive: "ekmek işini
 * Burak'a ata" adds the tag `burak`, and `/tag burak` lists
 * everything tagged that way. `/tag` with no argument lists every
 * tag currently in use in the chat.
 *
 * Plain-text render (like /today). For tap-to-toggle use /items.
 */
import type { Context } from "grammy";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items } from "@/lib/db/schema";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleTag(ctx: Context): Promise<void> {
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

  // Args after the command name (strip "/tag" / "/tag@bot").
  const raw = (message.text ?? "").trim();
  const arg = raw
    .replace(/^\/tag(?:@\w+)?\s*/i, "")
    .replace(/^#/, "")
    .trim()
    .toLowerCase();

  // No argument → list every tag in use, with counts.
  if (arg.length === 0) {
    const tagRows = await db
      .select({ tag: sql<string>`unnest(${items.tags})`, count: sql<number>`count(*)::int` })
      .from(items)
      .where(
        and(
          eq(items.chatId, chatId),
          eq(items.kind, "todo"),
          eq(items.isDone, false),
          isNull(items.archivedAt),
        ),
      )
      .groupBy(sql`unnest(${items.tags})`)
      .orderBy(sql`count(*) DESC`);
    if (tagRows.length === 0) {
      await ctx.reply(
        locale === "tr"
          ? "🏷️ Henüz etiket yok. Bir işe etiket eklemek için: \"x işini #burak ile etiketle\"."
          : "🏷️ No tags yet. Tag an item with: \"tag x with #burak\".",
      );
      return;
    }
    const lines = [
      locale === "tr" ? "🏷️ Etiketler:" : "🏷️ Tags:",
      "",
      ...tagRows.map((r) => `#${r.tag} — ${r.count}`),
      "",
      locale === "tr"
        ? "Bir etiketin işlerini görmek için: /tag <etiket>"
        : "List a tag's items with: /tag <name>",
    ];
    await ctx.reply(lines.join("\n"));
    return;
  }

  // Argument → list open todos carrying that tag.
  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        eq(items.kind, "todo"),
        eq(items.isDone, false),
        isNull(items.archivedAt),
        sql`${arg} = ANY(${items.tags})`,
      ),
    )
    .orderBy(asc(items.position), asc(items.createdAt));

  if (rows.length === 0) {
    await ctx.reply(
      locale === "tr"
        ? `🏷️ #${arg} etiketli açık iş yok.`
        : `🏷️ No open items tagged #${arg}.`,
    );
    return;
  }

  const lines: string[] = [
    locale === "tr"
      ? `🏷️ #${arg} (${rows.length})`
      : `🏷️ #${arg} (${rows.length})`,
    "",
  ];
  for (let i = 0; i < rows.length; i++) {
    const it = rows[i]!;
    const priority = it.priority === "high" ? "🔥 " : "";
    const otherTags = (it.tags ?? [])
      .filter((t) => t.toLowerCase() !== arg)
      .slice(0, 3)
      .map((t) => `#${t}`)
      .join(" ");
    const suffix = otherTags ? ` ${otherTags}` : "";
    lines.push(`${i + 1}. ☐ ${priority}${it.text}${suffix}`);
  }
  await ctx.reply(lines.join("\n"));
}
