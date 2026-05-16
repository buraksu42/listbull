/**
 * /items — render the current chat's items as inline-keyboard cards
 * (Phase 17, chat-rich UX MVP).
 *
 * Per item row: [☐/✅ toggle]  [✏️ edit]  [🗑️ delete]
 * Bottom row : [← prev]  [+ add]  [next →] when paginating
 *
 * Callback prefixes (routed in handlers/item-action-callback.ts):
 *   item:toggle:<itemId>
 *   item:edit:<itemId>
 *   item:delete:<itemId>
 *   item:page:<offset>
 *   items:add
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { itemAttachments, items } from "@/lib/db/schema";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

// Page size kept small so each item's label + action row sit together
// on screen — the screenshot bug (scrolled-off buttons being ambiguous)
// was a consequence of 10 items × 2 rows = 20 rows of buttons.
const PAGE_SIZE = 5;

export async function handleItems(ctx: Context): Promise<void> {
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

  const { text, keyboard } = await buildItemsView(chatId, locale, 0);
  await ctx.reply(text, { reply_markup: keyboard });
}

/**
 * Build the body text + inline keyboard for the /list view. Exported
 * so the item-action-callback can re-render after toggle/delete/page.
 */
export async function buildItemsView(
  chatId: number,
  locale: "tr" | "en",
  offset: number,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  // /items renders to-dos only — memory items have their own /memory
  // surface (Phase 17b). The kind filter keeps the existing UX exactly
  // the same for any pre-existing rows since the default is 'todo'.
  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        eq(items.kind, "todo"),
        isNull(items.archivedAt),
      ),
    )
    .orderBy(asc(items.isDone), asc(items.position), asc(items.createdAt))
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
        isNull(items.archivedAt),
      ),
    );
  const total = totalRow.length;

  // One-shot attachment count for the visible page so we can render
  // 📎N indicator + know whether to label the action as "attach" or
  // "view" without N round-trips.
  const visibleIds = (hasNext ? rows.slice(0, PAGE_SIZE) : rows).map(
    (r) => r.id,
  );
  const attachmentCounts = new Map<string, number>();
  if (visibleIds.length > 0) {
    const counts = await db
      .select({
        itemId: itemAttachments.itemId,
        count: sql<number>`count(*)::int`,
      })
      .from(itemAttachments)
      .where(inArray(itemAttachments.itemId, visibleIds))
      .groupBy(itemAttachments.itemId);
    for (const row of counts) attachmentCounts.set(row.itemId, row.count);
  }

  const header =
    locale === "tr"
      ? `📋 Yapılacaklar (${total})`
      : `📋 To-do (${total})`;

  if (visible.length === 0) {
    const empty =
      locale === "tr"
        ? "Henüz hiçbir şey yok. Mesaj at, ekleyim."
        : "Nothing here yet. Drop a message, I'll add it.";
    const keyboard = new InlineKeyboard().text(
      locale === "tr" ? "+ Ekle" : "+ Add",
      "items:add",
    );
    return { text: `${header}\n\n${empty}`, keyboard };
  }

  const lines: string[] = [header, ""];
  const keyboard = new InlineKeyboard();
  const nowMs = Date.now();
  for (let i = 0; i < visible.length; i++) {
    const it = visible[i]!;
    const num = offset + i + 1;
    const checkbox = it.isDone ? "✅" : "☐";
    const priorityIcon =
      it.priority === "high" ? "🔥 " : it.priority === "low" ? "💤 " : "";
    const statusIcon =
      it.status === "in_progress" && !it.isDone
        ? "📌 "
        : it.status === "blocked"
          ? "⏸️ "
          : "";
    const tags = (it.tags ?? []).slice(0, 3).map((t) => `#${t}`).join(" ");
    const tagSuffix = tags ? ` ${tags}` : "";
    // Deadline indicator: ⚠️ overdue, ⏰ today/soon, 📅 future
    let deadlineSuffix = "";
    if (it.deadlineAt) {
      const due = it.deadlineAt.getTime();
      const diffMs = due - nowMs;
      const oneDay = 24 * 60 * 60 * 1000;
      if (diffMs < 0) {
        deadlineSuffix = " ⚠️";
      } else if (diffMs < oneDay) {
        deadlineSuffix = " ⏰";
      } else {
        deadlineSuffix = " 📅";
      }
    }
    const text =
      it.text.length > 50 ? `${it.text.slice(0, 50)}…` : it.text;
    const attachCount = attachmentCounts.get(it.id) ?? 0;
    const attachSuffix = attachCount > 0 ? ` 📎${attachCount}` : "";
    lines.push(
      `${num}. ${checkbox} ${priorityIcon}${statusIcon}${text}${deadlineSuffix}${attachSuffix}${tagSuffix}`,
    );
    // Row A — wide numbered label, taps to toggle. Number prevents the
    // "which item does this button belong to?" ambiguity when the
    // keyboard scrolls past its header.
    const labelText =
      it.text.length > 26 ? `${it.text.slice(0, 26)}…` : it.text;
    keyboard
      .text(
        `${num}. ${checkbox} ${labelText}`,
        `item:toggle:${it.id}`,
      )
      .row();
    // Row B — 5 narrow action buttons. Order tuned for frequency:
    // edit (most common), deadline, reminder, attach, delete (least).
    // 📎 button shows count when files exist, so tapping it is also
    // a hint that there's something to download.
    const attachLabel = attachCount > 0 ? `📎${attachCount}` : "📎";
    keyboard
      .text("✏️", `item:edit:${it.id}`)
      .text("📅", `item:deadline:${it.id}`)
      .text("⏰", `item:reminder:${it.id}`)
      .text(attachLabel, `item:attach:${it.id}`)
      .text("🗑️", `item:delete:${it.id}`)
      .row();
  }

  // Bottom row: pagination + add
  const bottom: Array<{ label: string; data: string }> = [];
  if (offset > 0) {
    bottom.push({
      label: locale === "tr" ? "← Önceki" : "← Prev",
      data: `item:page:${Math.max(0, offset - PAGE_SIZE)}`,
    });
  }
  bottom.push({
    label: locale === "tr" ? "+ Ekle" : "+ Add",
    data: "items:add",
  });
  if (hasNext) {
    bottom.push({
      label: locale === "tr" ? "Sonraki →" : "Next →",
      data: `item:page:${offset + PAGE_SIZE}`,
    });
  }
  for (const b of bottom) {
    keyboard.text(b.label, b.data);
  }

  return { text: lines.join("\n"), keyboard };
}
