/**
 * Callback router for /list inline-keyboard buttons (Phase 17).
 *
 * callback_data prefixes:
 *   item:toggle:<itemId>   → flip is_done, edit message
 *   item:edit:<itemId>     → force-reply prompt; LLM handles the reply
 *   item:delete:<itemId>   → soft-delete + edit message
 *   item:page:<offset>     → re-render with new offset
 *   items:add              → force-reply prompt for new item text
 */
import type { Context } from "grammy";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import { buildItemsView } from "@/lib/server/bot/commands/items";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";
import { toItemSnapshot } from "@/lib/db/snapshots";

export async function handleItemActionCallback(
  ctx: Context,
): Promise<void> {
  const cb = ctx.callbackQuery;
  if (!cb || typeof cb.data !== "string") return;
  const data = cb.data;
  if (!data.startsWith("item:") && !data.startsWith("list:")) return;

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCallbackQuery("No chat context.");
    return;
  }

  const user = await getUserByTelegramId(cb.from.id);
  if (!user) {
    await ctx.answerCallbackQuery("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);

  // list:add — force-reply prompt for new item text.
  if (data === "items:add") {
    await ctx.answerCallbackQuery();
    await ctx.api.sendMessage(
      chatId,
      locale === "tr" ? "Yeni item ne?" : "What's the new item?",
      {
        reply_markup: {
          force_reply: true,
          selective: true,
        },
      },
    );
    return;
  }

  // item:page:<offset> — re-render the view.
  if (data.startsWith("item:page:")) {
    const offset = Number.parseInt(data.slice("item:page:".length), 10) || 0;
    await ctx.answerCallbackQuery();
    const view = await buildItemsView(chatId, locale, offset);
    await ctx.editMessageText(view.text, {
      reply_markup: view.keyboard,
    });
    return;
  }

  // item:toggle:<itemId>
  if (data.startsWith("item:toggle:")) {
    const itemId = data.slice("item:toggle:".length);
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
        .limit(1);
      if (!current) return;
      const next = !current.isDone;
      const [updated] = await tx
        .update(items)
        .set({
          isDone: next,
          status: next ? "done" : "open",
          completedAt: next ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId))
        .returning();
      if (!updated) return;
      await tx.insert(activityLog).values({
        chatId,
        entityType: "item",
        entityId: itemId,
        action: next ? "item_completed" : "item_uncompleted",
        actorId: user.id,
        payloadBefore: toItemSnapshot(current),
        payloadAfter: toItemSnapshot(updated),
      });
    });
    await ctx.answerCallbackQuery();
    const view = await buildItemsView(chatId, locale, 0);
    await ctx.editMessageText(view.text, {
      reply_markup: view.keyboard,
    });
    return;
  }

  // item:delete:<itemId> — soft delete + re-render.
  if (data.startsWith("item:delete:")) {
    const itemId = data.slice("item:delete:".length);
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
        .limit(1);
      if (!current) return;
      const now = new Date();
      const [archived] = await tx
        .update(items)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(items.id, itemId))
        .returning();
      if (!archived) return;
      await tx.insert(activityLog).values({
        chatId,
        entityType: "item",
        entityId: itemId,
        action: "item_deleted",
        actorId: user.id,
        payloadBefore: toItemSnapshot(current),
        payloadAfter: toItemSnapshot(archived),
      });
    });
    await ctx.answerCallbackQuery(
      locale === "tr" ? "Silindi" : "Deleted",
    );
    const view = await buildItemsView(chatId, locale, 0);
    await ctx.editMessageText(view.text, {
      reply_markup: view.keyboard,
    });
    return;
  }

  // item:edit:<itemId> — force-reply prompt; user's reply text passes
  // to LLM via handle-message which will call update_item.
  if (data.startsWith("item:edit:")) {
    const itemId = data.slice("item:edit:".length);
    await ctx.answerCallbackQuery();
    await ctx.api.sendMessage(
      chatId,
      locale === "tr"
        ? `Yeni metni yaz (item id: ${itemId}):`
        : `New text? (item id: ${itemId}):`,
      {
        reply_markup: {
          force_reply: true,
          selective: true,
        },
      },
    );
    return;
  }
}
