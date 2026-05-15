/**
 * Callback router for /items inline-keyboard buttons (Phase 17).
 *
 * callback_data prefixes:
 *   item:toggle:<itemId>    → flip is_done, edit message
 *   item:edit:<itemId>      → force-reply prompt; LLM handles the reply
 *   item:deadline:<itemId>  → force-reply prompt for new deadline
 *   item:reminder:<itemId>  → force-reply prompt for new reminder
 *   item:attach:<itemId>    → force-reply prompt; user replies with a
 *                              photo/document/voice → handle-message
 *                              picks up the attachment + LLM calls
 *                              attach_file_to_item.
 *   item:delete:<itemId>    → soft-delete + edit message
 *   item:page:<offset>      → re-render with new offset
 *   items:add               → force-reply prompt for new item text
 *
 * Force-reply prompts persist their action context in
 * `bot_action_contexts` keyed by the sent message_id. The reply path
 * in handle-message looks the context up by reply_to_message.message_id
 * — no user-visible `[ctx:...]` marker needed in the prompt text.
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemAttachments, items } from "@/lib/db/schema";
import { buildItemsView } from "@/lib/server/bot/commands/items";
import { insertBotActionContext } from "@/lib/db/queries/bot-action-contexts";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";
import { toItemSnapshot } from "@/lib/db/snapshots";

export async function handleItemActionCallback(
  ctx: Context,
): Promise<void> {
  const cb = ctx.callbackQuery;
  if (!cb || typeof cb.data !== "string") return;
  const data = cb.data;
  // Prefixes we own: `item:*` (per-item actions) and `items:*`
  // (collection-level actions like `items:add`). The old `list:`
  // prefix is kept as a tolerant alias for any legacy keyboards
  // still floating in user chats from before the chat-only pivot.
  if (
    !data.startsWith("item:") &&
    !data.startsWith("items:") &&
    !data.startsWith("list:")
  ) {
    return;
  }

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
      locale === "tr" ? "✨ Yeni item ne yazayım?" : "✨ What's the new item?",
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
      locale === "tr" ? "🗑️ Silindi" : "🗑️ Deleted",
    );
    const view = await buildItemsView(chatId, locale, 0);
    await ctx.editMessageText(view.text, {
      reply_markup: view.keyboard,
    });
    return;
  }

  // 📎 button — context-aware:
  //   - 0 attachments → force-reply prompt to attach new file
  //   - ≥1 attachments → list each as a download button + add a
  //     "📥 İndir" + "+ Ekle" row.
  if (data.startsWith("item:attach:")) {
    const itemId = data.slice("item:attach:".length);
    const [item] = await db
      .select({ text: items.text })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
      .limit(1);
    if (!item) {
      await ctx.answerCallbackQuery();
      return;
    }
    const existing = await db
      .select()
      .from(itemAttachments)
      .where(eq(itemAttachments.itemId, itemId))
      .orderBy(asc(itemAttachments.createdAt));

    const title = item.text.length > 60 ? `${item.text.slice(0, 60)}…` : item.text;
    await ctx.answerCallbackQuery();

    if (existing.length === 0) {
      // No files yet → force-reply attach prompt (legacy behavior).
      const body =
        locale === "tr"
          ? `📎 "${title}" — bu mesaja fotoğraf, dosya veya ses göndererek ekle.`
          : `📎 "${title}" — reply to this message with a photo, file, or voice note to attach.`;
      const sent = await ctx.api.sendMessage(chatId, body, {
        reply_markup: { force_reply: true, selective: true },
      });
      await insertBotActionContext({
        chatId,
        messageId: sent.message_id,
        action: "attach",
        itemId,
        targetChatId: null,
      });
      return;
    }

    // Render the existing attachments + a "Yeni ekle" option.
    const lines: string[] = [
      locale === "tr"
        ? `📎 "${title}" — ${existing.length} ek dosya`
        : `📎 "${title}" — ${existing.length} attached file(s)`,
      "",
    ];
    const kb = new InlineKeyboard();
    for (let i = 0; i < existing.length; i++) {
      const a = existing[i]!;
      const label =
        a.originalFilename ??
        a.mimeType ??
        `${a.kind} ${i + 1}`;
      const trimmed = label.length > 40 ? `${label.slice(0, 40)}…` : label;
      lines.push(`${i + 1}. ${attachmentIcon(a.kind)} ${trimmed}`);
      kb.text(
        `📥 ${i + 1}`,
        `item:attach_dl:${a.id}`,
      );
    }
    kb.row();
    kb.text(
      locale === "tr" ? "+ Yeni dosya ekle" : "+ Add new file",
      `item:attach_new:${itemId}`,
    );
    await ctx.api.sendMessage(chatId, lines.join("\n"), {
      reply_markup: kb,
    });
    return;
  }

  // item:attach_new:<id> — force-reply prompt explicitly for "add
  // more files" path so we don't accidentally re-list existing ones.
  if (data.startsWith("item:attach_new:")) {
    const itemId = data.slice("item:attach_new:".length);
    const [item] = await db
      .select({ text: items.text })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
      .limit(1);
    if (!item) {
      await ctx.answerCallbackQuery();
      return;
    }
    const title = item.text.length > 60 ? `${item.text.slice(0, 60)}…` : item.text;
    const body =
      locale === "tr"
        ? `📎 "${title}" — bu mesaja fotoğraf, dosya veya ses göndererek ekle.`
        : `📎 "${title}" — reply to this message with a photo, file, or voice note to attach.`;
    await ctx.answerCallbackQuery();
    const sent = await ctx.api.sendMessage(chatId, body, {
      reply_markup: { force_reply: true, selective: true },
    });
    await insertBotActionContext({
      chatId,
      messageId: sent.message_id,
      action: "attach",
      itemId,
      targetChatId: null,
    });
    return;
  }

  // item:attach_dl:<attachmentId> — resend the stored file_id.
  if (data.startsWith("item:attach_dl:")) {
    const attId = data.slice("item:attach_dl:".length);
    const [a] = await db
      .select()
      .from(itemAttachments)
      .where(eq(itemAttachments.id, attId))
      .limit(1);
    if (!a || a.chatId !== chatId) {
      await ctx.answerCallbackQuery(
        locale === "tr" ? "Dosya bulunamadı." : "File not found.",
      );
      return;
    }
    await ctx.answerCallbackQuery();
    try {
      switch (a.kind) {
        case "photo":
          await ctx.api.sendPhoto(chatId, a.telegramFileId);
          break;
        case "video":
          await ctx.api.sendVideo(chatId, a.telegramFileId);
          break;
        case "audio":
          await ctx.api.sendAudio(chatId, a.telegramFileId);
          break;
        case "voice":
          await ctx.api.sendVoice(chatId, a.telegramFileId);
          break;
        case "video_note":
          await ctx.api.sendVideoNote(chatId, a.telegramFileId);
          break;
        case "document":
        default:
          await ctx.api.sendDocument(chatId, a.telegramFileId);
          break;
      }
    } catch (err) {
      console.error("[item:attach_dl] resend failed", {
        attId,
        kind: a.kind,
        error: err instanceof Error ? err.message : String(err),
      });
      await ctx.api.sendMessage(
        chatId,
        locale === "tr"
          ? "❗️ Dosya gönderilemedi (file_id geçersiz olabilir)."
          : "❗️ Couldn't send file (file_id may have expired).",
      );
    }
    return;
  }

  // Force-reply action prompts. The action context (item id + kind)
  // is persisted in `bot_action_contexts` keyed by the sent message
  // id — no inline marker, the prompt body shows the item title so
  // the user knows which item they're acting on.
  const forceReplyActions: Array<{
    prefix: string;
    action: "edit" | "deadline" | "reminder" | "attach";
    promptFor: (itemText: string) => { tr: string; en: string };
  }> = [
    {
      prefix: "item:edit:",
      action: "edit",
      promptFor: (title) => ({
        tr: `✏️ "${title}" — yeni metni yaz.`,
        en: `✏️ "${title}" — what's the new text?`,
      }),
    },
    {
      prefix: "item:deadline:",
      action: "deadline",
      promptFor: (title) => ({
        tr: `📅 "${title}" — bitiş tarihi ne olsun? (örn. "yarın 18:00", "cuma", "3 gün sonra")`,
        en: `📅 "${title}" — what's the deadline? (e.g. "tomorrow 6pm", "Friday", "in 3 days")`,
      }),
    },
    {
      prefix: "item:reminder:",
      action: "reminder",
      promptFor: (title) => ({
        tr: `⏰ "${title}" — ne zaman hatırlatayım? (örn. "30 dakika sonra", "yarın 09:00", "bitiş tarihinden 1 gün önce")`,
        en: `⏰ "${title}" — when should I remind you? (e.g. "in 30 minutes", "tomorrow 9am", "1 day before deadline")`,
      }),
    },
    {
      prefix: "item:attach:",
      action: "attach",
      promptFor: (title) => ({
        tr: `📎 "${title}" — bu mesaja fotoğraf, dosya veya ses göndererek ekle.`,
        en: `📎 "${title}" — reply to this message with a photo, file, or voice note to attach.`,
      }),
    },
  ];
  // Note: item:attach is handled above with its own context-aware
  // branch (list existing files OR force-reply prompt). Skip the
  // duplicate generic-attach entry here to avoid double-handling.
  for (const a of forceReplyActions.filter((x) => x.prefix !== "item:attach:")) {
    if (data.startsWith(a.prefix)) {
      const itemId = data.slice(a.prefix.length);
      // Look up item title for a friendly prompt.
      const [item] = await db
        .select({ text: items.text })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
        .limit(1);
      const title = item?.text ?? itemId;
      const truncated = title.length > 60 ? `${title.slice(0, 60)}…` : title;
      const prompts = a.promptFor(truncated);
      const body = locale === "tr" ? prompts.tr : prompts.en;
      await ctx.answerCallbackQuery();
      const sent = await ctx.api.sendMessage(chatId, body, {
        reply_markup: {
          force_reply: true,
          selective: true,
        },
      });
      // Persist the action context keyed by the sent message_id so
      // handle-message can resolve the reply without a visible marker.
      await insertBotActionContext({
        chatId,
        messageId: sent.message_id,
        action: a.action,
        itemId,
        targetChatId: null,
      });
      return;
    }
  }
}

/** Map an attachment.kind to a recognizable icon for the list view. */
function attachmentIcon(kind: string): string {
  switch (kind) {
    case "photo":
      return "🖼️";
    case "video":
      return "🎥";
    case "audio":
      return "🎵";
    case "voice":
      return "🎤";
    case "video_note":
      return "📹";
    case "document":
    default:
      return "📄";
  }
}
