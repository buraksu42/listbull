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
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

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
  // Phase 17c: top-level only. Completed sub-items show up under their
  // parent's drill-in view, not as standalone rows here.
  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        eq(items.kind, "todo"),
        eq(items.isDone, true),
        isNull(items.archivedAt),
        isNull(items.parentItemId),
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
        isNull(items.parentItemId),
      ),
    );
  const total = totalRow.length;

  // Per-parent sub-item rollup so completed checklists show e.g.
  // "📂 3/3" (all children done) vs "📂 1/3" (parent done early).
  const visibleIds = visible.map((r) => r.id);
  const childDoneCounts = new Map<string, number>();
  const childTotalCounts = new Map<string, number>();
  if (visibleIds.length > 0) {
    const cCounts = await db
      .select({
        parentId: items.parentItemId,
        done: sql<number>`count(*) FILTER (WHERE ${items.isDone} = true)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(items)
      .where(
        and(
          inArray(items.parentItemId, visibleIds),
          isNull(items.archivedAt),
        ),
      )
      .groupBy(items.parentItemId);
    for (const row of cCounts) {
      if (!row.parentId) continue;
      childDoneCounts.set(row.parentId, row.done);
      childTotalCounts.set(row.parentId, row.total);
    }
  }

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
    const childTotal = childTotalCounts.get(it.id) ?? 0;
    const childDone = childDoneCounts.get(it.id) ?? 0;
    const childSuffix = childTotal > 0 ? ` 📂${childDone}/${childTotal}` : "";
    lines.push(`${num}. ✅ ${text}${childSuffix}${completedStr}`);
    // Row A — wide numbered label (no action; visual anchor)
    const labelText =
      it.text.length > 100 ? `${it.text.slice(0, 100)}…` : it.text;
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
