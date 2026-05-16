/**
 * /memory — never-auto-delete keepsakes (tickets, docs, receipts).
 *
 * Mirrors /items' UI scheme but:
 *  - scoped to kind='memory'
 *  - only top-level rows (parent_item_id IS NULL); sub-items will
 *    surface via the 📂 button (Phase D)
 *  - 🗑️ delete asks for an inline confirmation (Phase 17b memory
 *    contract: never delete without explicit confirm)
 *
 * Callback prefixes used by /memory keyboards:
 *   memory:toggle:<id>      → no-op (memory items have no done state);
 *                              tap just bounces a friendly answer
 *   memory:edit:<id>        → force-reply for new text
 *   memory:deadline:<id>    → force-reply for deadline
 *   memory:reminder:<id>    → force-reply for reminder
 *   memory:attach:<id>      → attach view / file list (reuses item code)
 *   memory:delete:<id>      → confirm sheet
 *   memory:delete_yes:<id>  → archive + re-render
 *   memory:delete_no:<id>   → just answer cb, no archive
 *   memory:page:<offset>    → re-render with offset
 *   memory:add              → force-reply for a new memory item
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { itemAttachments, itemReminders, items } from "@/lib/db/schema";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

const PAGE_SIZE = 5;

export async function handleMemory(ctx: Context): Promise<void> {
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

  const { text, keyboard } = await buildMemoryView(chatId, locale, 0);
  await ctx.reply(text, { reply_markup: keyboard });
}

/**
 * Build the body text + keyboard for the /memory view. Exported so
 * the action-callback handler can re-render after a delete or page.
 */
export async function buildMemoryView(
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
        eq(items.kind, "memory"),
        isNull(items.archivedAt),
        isNull(items.parentItemId),
      ),
    )
    .orderBy(asc(items.position), asc(items.createdAt))
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
        eq(items.kind, "memory"),
        isNull(items.archivedAt),
        isNull(items.parentItemId),
      ),
    );
  const total = totalRow.length;

  const visibleIds = visible.map((r) => r.id);
  const attachmentCounts = new Map<string, number>();
  const reminderCounts = new Map<string, number>();
  const childCounts = new Map<string, number>();
  if (visibleIds.length > 0) {
    const aCounts = await db
      .select({
        itemId: itemAttachments.itemId,
        count: sql<number>`count(*)::int`,
      })
      .from(itemAttachments)
      .where(inArray(itemAttachments.itemId, visibleIds))
      .groupBy(itemAttachments.itemId);
    for (const r of aCounts) attachmentCounts.set(r.itemId, r.count);

    const rCounts = await db
      .select({
        itemId: itemReminders.itemId,
        count: sql<number>`count(*)::int`,
      })
      .from(itemReminders)
      .where(
        and(
          inArray(itemReminders.itemId, visibleIds),
          eq(itemReminders.sent, false),
        ),
      )
      .groupBy(itemReminders.itemId);
    for (const r of rCounts) reminderCounts.set(r.itemId, r.count);

    const cCounts = await db
      .select({
        parentItemId: items.parentItemId,
        count: sql<number>`count(*)::int`,
      })
      .from(items)
      .where(
        and(
          inArray(items.parentItemId, visibleIds),
          isNull(items.archivedAt),
        ),
      )
      .groupBy(items.parentItemId);
    for (const r of cCounts) {
      if (r.parentItemId) childCounts.set(r.parentItemId, r.count);
    }
  }

  const header =
    locale === "tr"
      ? `📁 Hafıza (${total})`
      : `📁 Memory (${total})`;

  if (visible.length === 0) {
    const empty =
      locale === "tr"
        ? "Henüz hafızada hiçbir şey yok. Bir şey saklamak için \"konser biletini hafızaya al\" yaz."
        : "Nothing in memory yet. Say \"save the concert tickets\" to keep something here.";
    const keyboard = new InlineKeyboard().text(
      locale === "tr" ? "+ Ekle" : "+ Add",
      "memory:add",
    );
    return { text: `${header}\n\n${empty}`, keyboard };
  }

  const lines: string[] = [header, ""];
  const keyboard = new InlineKeyboard();
  const nowMs = Date.now();
  for (let i = 0; i < visible.length; i++) {
    const it = visible[i]!;
    const num = offset + i + 1;
    const priorityIcon =
      it.priority === "high" ? "🔥 " : it.priority === "low" ? "💤 " : "";
    const tags = (it.tags ?? []).slice(0, 3).map((t) => `#${t}`).join(" ");
    const tagSuffix = tags ? ` ${tags}` : "";
    let deadlineSuffix = "";
    if (it.deadlineAt) {
      const due = it.deadlineAt.getTime();
      const diffMs = due - nowMs;
      const oneDay = 24 * 60 * 60 * 1000;
      if (diffMs < 0) deadlineSuffix = " ⚠️";
      else if (diffMs < oneDay) deadlineSuffix = " ⏰";
      else deadlineSuffix = " 📅";
    }
    const attachCount = attachmentCounts.get(it.id) ?? 0;
    const attachSuffix = attachCount > 0 ? ` 📎${attachCount}` : "";
    const reminderCount = reminderCounts.get(it.id) ?? 0;
    const reminderSuffix = reminderCount > 0 ? " 🔔" : "";
    const childCount = childCounts.get(it.id) ?? 0;
    const childSuffix = childCount > 0 ? ` 📂${childCount}` : "";
    const text =
      it.text.length > 50 ? `${it.text.slice(0, 50)}…` : it.text;
    lines.push(
      `${num}. 📌 ${priorityIcon}${text}${deadlineSuffix}${reminderSuffix}${attachSuffix}${childSuffix}${tagSuffix}`,
    );

    // Row A — wide numbered label. Memory items don't toggle; tap
    // bounces a small CB answer so the user sees they tapped on the
    // right row.
    const labelText =
      it.text.length > 26 ? `${it.text.slice(0, 26)}…` : it.text;
    keyboard
      .text(`${num}. 📌 ${labelText}`, `memory:toggle:${it.id}`)
      .row();
    // Row B — same action vocabulary as /items, plus 📂 if children.
    const attachLabel = attachCount > 0 ? `📎${attachCount}` : "📎";
    keyboard
      .text("✏️", `memory:edit:${it.id}`)
      .text("📅", `memory:deadline:${it.id}`)
      .text("⏰", `memory:reminder:${it.id}`)
      .text(attachLabel, `memory:attach:${it.id}`)
      .text("🗑️", `memory:delete:${it.id}`)
      .row();
  }

  const bottom: Array<{ label: string; data: string }> = [];
  if (offset > 0) {
    bottom.push({
      label: locale === "tr" ? "← Önceki" : "← Prev",
      data: `memory:page:${Math.max(0, offset - PAGE_SIZE)}`,
    });
  }
  bottom.push({
    label: locale === "tr" ? "+ Ekle" : "+ Add",
    data: "memory:add",
  });
  if (hasNext) {
    bottom.push({
      label: locale === "tr" ? "Sonraki →" : "Next →",
      data: `memory:page:${offset + PAGE_SIZE}`,
    });
  }
  for (const b of bottom) keyboard.text(b.label, b.data);

  return { text: lines.join("\n"), keyboard };
}
