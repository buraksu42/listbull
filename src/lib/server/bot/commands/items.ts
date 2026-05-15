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
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items } from "@/lib/db/schema";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

const PAGE_SIZE = 10;

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
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.chatId, chatId), isNull(items.archivedAt)))
    .orderBy(asc(items.isDone), asc(items.position), asc(items.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasNext = rows.length > PAGE_SIZE;
  const visible = hasNext ? rows.slice(0, PAGE_SIZE) : rows;

  const totalRow = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.chatId, chatId), isNull(items.archivedAt)));
  const total = totalRow.length;

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
  for (let i = 0; i < visible.length; i++) {
    const it = visible[i]!;
    const num = offset + i + 1;
    const icon = it.isDone ? "✅" : "☐";
    const tag = it.priority === "high" ? " 🔥" : "";
    const text =
      it.text.length > 60 ? `${it.text.slice(0, 60)}…` : it.text;
    lines.push(`${num}. ${icon} ${text}${tag}`);
    keyboard
      .text(icon, `item:toggle:${it.id}`)
      .text("✏️", `item:edit:${it.id}`)
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
