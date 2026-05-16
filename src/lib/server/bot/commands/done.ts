/**
 * /done — completed to-do items.
 *
 * Mirrors /items but filtered to `is_done=true`, ordered by
 * `completedAt DESC` (most recent first). Each row gets two action
 * buttons:
 *   ↩️ — re-open (is_done → false, status → open, completedAt → null)
 *   🗑️ — permanent archive (archived_at = NOW). Asks for confirmation
 *
 * Callback prefixes used by /done keyboards:
 *   done:reopen:<id>          → flip is_done=false, re-render
 *   done:archive:<id>         → confirm sheet
 *   done:archive_yes:<id>     → set archived_at, re-render
 *   done:archive_no:<id>      → cancel
 *   done:page:<offset>        → re-render with new offset
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items } from "@/lib/db/schema";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

const PAGE_SIZE = 5;

export async function handleDone(ctx: Context): Promise<void> {
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

  const { text, keyboard } = await buildDoneView(chatId, locale, 0);
  await ctx.reply(text, { reply_markup: keyboard });
}

export async function buildDoneView(
  chatId: number,
  locale: "tr" | "en",
  offset: number,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        eq(items.kind, "todo"),
        eq(items.isDone, true),
        isNull(items.archivedAt),
      ),
    )
    .orderBy(desc(items.completedAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasNext = rows.length > PAGE_SIZE;
  const visible = hasNext ? rows.slice(0, PAGE_SIZE) : rows;

  const totalRow = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        eq(items.kind, "todo"),
        eq(items.isDone, true),
        isNull(items.archivedAt),
      ),
    );
  const total = totalRow.length;

  const header =
    locale === "tr"
      ? `✅ Tamamlananlar (${total})`
      : `✅ Done (${total})`;

  if (visible.length === 0) {
    const empty =
      locale === "tr"
        ? "Henüz tamamlanmış iş yok. ✨"
        : "Nothing completed yet. ✨";
    return {
      text: `${header}\n\n${empty}`,
      keyboard: new InlineKeyboard(),
    };
  }

  const lines: string[] = [header, ""];
  const keyboard = new InlineKeyboard();
  const fmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    day: "numeric",
    month: "short",
  });
  for (let i = 0; i < visible.length; i++) {
    const it = visible[i]!;
    const num = offset + i + 1;
    const completedStr = it.completedAt
      ? ` — ${fmt.format(it.completedAt)}`
      : "";
    const text = it.text.length > 50 ? `${it.text.slice(0, 50)}…` : it.text;
    lines.push(`${num}. ✅ ${text}${completedStr}`);
    // Row A — wide numbered label (no action; visual anchor)
    const labelText =
      it.text.length > 26 ? `${it.text.slice(0, 26)}…` : it.text;
    keyboard.text(`${num}. ✅ ${labelText}`, `done:noop:${it.id}`).row();
    // Row B — re-open + archive
    keyboard
      .text(
        locale === "tr" ? "↩️ Geri aç" : "↩️ Reopen",
        `done:reopen:${it.id}`,
      )
      .text(
        locale === "tr" ? "🗑️ Arşivle" : "🗑️ Archive",
        `done:archive:${it.id}`,
      )
      .row();
  }

  const bottom: Array<{ label: string; data: string }> = [];
  if (offset > 0) {
    bottom.push({
      label: locale === "tr" ? "← Önceki" : "← Prev",
      data: `done:page:${Math.max(0, offset - PAGE_SIZE)}`,
    });
  }
  if (hasNext) {
    bottom.push({
      label: locale === "tr" ? "Sonraki →" : "Next →",
      data: `done:page:${offset + PAGE_SIZE}`,
    });
  }
  for (const b of bottom) keyboard.text(b.label, b.data);

  return { text: lines.join("\n"), keyboard };
}
