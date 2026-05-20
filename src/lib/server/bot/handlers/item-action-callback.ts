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
import { buildDoneView } from "@/lib/server/bot/commands/done";
import { buildItemsView } from "@/lib/server/bot/commands/items";
import { buildMemoryView } from "@/lib/server/bot/commands/memory";
import { buildSubItemsView } from "@/lib/server/bot/views/sub-items";
import { insertBotActionContext } from "@/lib/db/queries/bot-action-contexts";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";
import { rollupParentDoneState, type RollupResult } from "@/lib/server/tools/_shared";
import { toItemSnapshot } from "@/lib/db/snapshots";

export async function handleItemActionCallback(
  ctx: Context,
): Promise<void> {
  const cb = ctx.callbackQuery;
  if (!cb || typeof cb.data !== "string") return;
  let data = cb.data;
  // Prefixes we own: `item:*` and `items:*` (todos), `memory:*`
  // (memory-mode actions), `done:*` (completed view). These match
  // the prefix set the index.ts callback router forwards here.
  if (
    !data.startsWith("item:") &&
    !data.startsWith("items:") &&
    !data.startsWith("memory:") &&
    !data.startsWith("done:")
  ) {
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCallbackQuery("No chat context.");
    return;
  }
  // `selective: true` on force_reply requires Telegram to know which
  // user to pop the reply UI for — either via @-mention or a
  // reply-to. Our prompts ("✏️ X — yeni metni yaz") don't include a
  // user mention, so in groups Telegram opens the popup for NOBODY,
  // and the user's typed reply isn't auto-linked. Drop selective in
  // groups so the popup opens for everyone in the group (the one who
  // tapped will see it first). DM is single-user so selective is
  // moot there.
  const isGroup =
    ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

  const user = await getUserByTelegramId(cb.from.id);
  if (!user) {
    await ctx.answerCallbackQuery("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);

  // ─── memory: surface-specific handlers ──────────────────────────
  //
  // Most "open a force-reply for action X on item Y" actions are
  // shared between /items and /memory — we normalize them at the
  // bottom of this block. Memory needs distinct flows for:
  //   - add  → force-reply with action context kind='memory'
  //   - toggle → no-op (memory items don't have done state)
  //   - delete → confirmation sheet, never archive directly
  //   - page → re-render /memory view with new offset

  if (data === "memory:add") {
    await ctx.answerCallbackQuery();
    const sent = await ctx.api.sendMessage(
      chatId,
      locale === "tr"
        ? "📁 Hafızaya ne ekleyeyim?"
        : "📁 What should I keep in memory?",
      { reply_markup: { force_reply: true, selective: !isGroup } },
    );
    await insertBotActionContext({
      chatId,
      messageId: sent.message_id,
      action: "memory_add",
      itemId: null,
      targetChatId: null,
      metadata: null,
    });
    return;
  }

  if (data.startsWith("memory:page:")) {
    const offset =
      Number.parseInt(data.slice("memory:page:".length), 10) || 0;
    await ctx.answerCallbackQuery();
    const view = await buildMemoryView(chatId, locale, offset);
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    return;
  }

  if (data.startsWith("memory:toggle:")) {
    // Memory items don't toggle — friendly nudge.
    await ctx.answerCallbackQuery(
      locale === "tr"
        ? "📁 Hafıza item'ları işaretlenmez."
        : "📁 Memory items have no done state.",
    );
    return;
  }

  if (data.startsWith("memory:delete:")) {
    const itemId = data.slice("memory:delete:".length);
    const [it] = await db
      .select({ text: items.text })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
      .limit(1);
    if (!it) {
      await ctx.answerCallbackQuery(
        locale === "tr" ? "Bulunamadı." : "Not found.",
      );
      return;
    }
    const title = it.text.length > 60 ? `${it.text.slice(0, 60)}…` : it.text;
    await ctx.answerCallbackQuery();
    await ctx.api.sendMessage(
      chatId,
      locale === "tr"
        ? `🗑️ "${title}" hafızadan silinsin mi? Bu geri alınmaz.`
        : `🗑️ Delete "${title}" from memory? This can't be undone.`,
      {
        reply_markup: new InlineKeyboard()
          .text(
            locale === "tr" ? "✅ Evet, sil" : "✅ Yes, delete",
            `memory:delete_yes:${itemId}`,
          )
          .text(
            locale === "tr" ? "❌ İptal" : "❌ Cancel",
            `memory:delete_no:${itemId}`,
          ),
      },
    );
    return;
  }

  if (data.startsWith("memory:delete_yes:")) {
    const itemId = data.slice("memory:delete_yes:".length);
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
    // Replace the confirm prompt with a small ack so user doesn't
    // get a stale "are you sure?" message sitting in the chat.
    try {
      await ctx.editMessageText(
        locale === "tr" ? "🗑️ Silindi." : "🗑️ Deleted.",
      );
    } catch {
      // ignore "not modified" / "message can't be edited"
    }
    return;
  }

  if (data.startsWith("memory:delete_no:")) {
    await ctx.answerCallbackQuery(
      locale === "tr" ? "İptal" : "Cancelled",
    );
    try {
      await ctx.editMessageText(
        locale === "tr" ? "❌ İptal edildi." : "❌ Cancelled.",
      );
    } catch {
      // ignore
    }
    return;
  }

  // Shared actions: edit / deadline / reminder / attach* — same UX
  // on /memory as /items, so we rewrite the prefix and fall through
  // to the existing handlers.
  if (
    data.startsWith("memory:edit:") ||
    data.startsWith("memory:deadline:") ||
    data.startsWith("memory:reminder:") ||
    data.startsWith("memory:attach:") ||
    data.startsWith("memory:attach_new:") ||
    data.startsWith("memory:attach_dl:")
  ) {
    data = data.replace(/^memory:/, "item:");
  }

  // ─── /done surface handlers ─────────────────────────────────────

  if (data.startsWith("done:noop:")) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith("done:page:")) {
    const offset =
      Number.parseInt(data.slice("done:page:".length), 10) || 0;
    await ctx.answerCallbackQuery();
    const view = await buildDoneView(chatId, locale, offset);
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    return;
  }

  if (data.startsWith("done:reopen:")) {
    const itemId = data.slice("done:reopen:".length);
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
        .limit(1);
      if (!current) return;
      const [updated] = await tx
        .update(items)
        .set({
          isDone: false,
          status: "open",
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId))
        .returning();
      if (!updated) return;
      await tx.insert(activityLog).values({
        chatId,
        entityType: "item",
        entityId: itemId,
        action: "item_uncompleted",
        actorId: user.id,
        payloadBefore: toItemSnapshot(current),
        payloadAfter: toItemSnapshot(updated),
      });
    });
    await ctx.answerCallbackQuery(
      locale === "tr" ? "↩️ Geri açıldı" : "↩️ Reopened",
    );
    const view = await buildDoneView(chatId, locale, 0);
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    return;
  }

  if (data.startsWith("done:archive:")) {
    const itemId = data.slice("done:archive:".length);
    const [it] = await db
      .select({ text: items.text })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
      .limit(1);
    if (!it) {
      await ctx.answerCallbackQuery(
        locale === "tr" ? "Bulunamadı." : "Not found.",
      );
      return;
    }
    const title = it.text.length > 60 ? `${it.text.slice(0, 60)}…` : it.text;
    await ctx.answerCallbackQuery();
    await ctx.api.sendMessage(
      chatId,
      locale === "tr"
        ? `🗑️ "${title}" kalıcı arşivlensin mi? /done listesinden çıkar; activity log'da iz kalır.`
        : `🗑️ Archive "${title}" permanently? Removes from /done; activity log keeps a trace.`,
      {
        reply_markup: new InlineKeyboard()
          .text(
            locale === "tr" ? "✅ Evet, arşivle" : "✅ Yes, archive",
            `done:archive_yes:${itemId}`,
          )
          .text(
            locale === "tr" ? "❌ İptal" : "❌ Cancel",
            `done:archive_no:${itemId}`,
          ),
      },
    );
    return;
  }

  if (data.startsWith("done:archive_yes:")) {
    const itemId = data.slice("done:archive_yes:".length);
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
      locale === "tr" ? "🗑️ Arşivlendi" : "🗑️ Archived",
    );
    try {
      await ctx.editMessageText(
        locale === "tr" ? "🗑️ Arşivlendi." : "🗑️ Archived.",
      );
    } catch {
      // ignore
    }
    return;
  }

  if (data.startsWith("done:archive_no:")) {
    await ctx.answerCallbackQuery(
      locale === "tr" ? "İptal" : "Cancelled",
    );
    try {
      await ctx.editMessageText(
        locale === "tr" ? "❌ İptal edildi." : "❌ Cancelled.",
      );
    } catch {
      // ignore
    }
    return;
  }

  // ─── Sub-items drill-in (Phase 17c) ───────────────────────────
  //
  // Callback shapes:
  //   item:children:<parentId>             → render sub-items view
  //   item:children_page:<parentId>:<off>  → paginate within view
  //   item:children_back                    → back to /items page 0
  //   item:add_child:<parentId>             → force-reply for new sub-item

  if (data === "item:children_back") {
    await ctx.answerCallbackQuery();
    const view = await buildItemsView(chatId, locale, 0);
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    return;
  }

  if (data.startsWith("item:children_page:")) {
    const rest = data.slice("item:children_page:".length);
    const sepIdx = rest.lastIndexOf(":");
    if (sepIdx === -1) {
      await ctx.answerCallbackQuery();
      return;
    }
    const parentId = rest.slice(0, sepIdx);
    const offset = Number.parseInt(rest.slice(sepIdx + 1), 10) || 0;
    await ctx.answerCallbackQuery();
    const view = await buildSubItemsView(parentId, chatId, locale, offset);
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    return;
  }

  if (data.startsWith("item:children:")) {
    const parentId = data.slice("item:children:".length);
    await ctx.answerCallbackQuery();
    const view = await buildSubItemsView(parentId, chatId, locale, 0);
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    return;
  }

  if (data.startsWith("item:add_child:")) {
    const parentId = data.slice("item:add_child:".length);
    const [parent] = await db
      .select({ text: items.text })
      .from(items)
      .where(and(eq(items.id, parentId), eq(items.chatId, chatId)))
      .limit(1);
    if (!parent) {
      await ctx.answerCallbackQuery(
        locale === "tr" ? "Liste bulunamadı." : "List not found.",
      );
      return;
    }
    const title =
      parent.text.length > 60 ? `${parent.text.slice(0, 60)}…` : parent.text;
    const body =
      locale === "tr"
        ? `📂 "${title}" altına ne ekleyeyim?`
        : `📂 What to add under "${title}"?`;
    await ctx.answerCallbackQuery();
    const sent = await ctx.api.sendMessage(chatId, body, {
      reply_markup: { force_reply: true, selective: !isGroup },
    });
    await insertBotActionContext({
      chatId,
      messageId: sent.message_id,
      action: "add_child",
      itemId: parentId,
      targetChatId: null,
      metadata: null,
    });
    return;
  }

  // items:add — force-reply prompt for new item text.
  //
  // In groups: drop `selective: true` (otherwise Telegram requires a
  // mention/reply target which we don't have here — the popup wouldn't
  // appear and the user would type a regular message that needs
  // @-mention to be visible to the bot under privacy mode). Persist a
  // bot_action_context so the reply path in handle-message routes it
  // to create_item without needing the user to phrase the intent.
  if (data === "items:add") {
    await ctx.answerCallbackQuery();
    const isGroup =
      ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    const sent = await ctx.api.sendMessage(
      chatId,
      locale === "tr" ? "✨ Yeni item ne yazayım?" : "✨ What's the new item?",
      {
        reply_markup: {
          force_reply: true,
          // Selective targets only @-mentioned users — in groups the
          // popup hides if nobody is mentioned. DM only has one user
          // anyway, so non-selective is harmless there too.
          selective: !isGroup,
        },
      },
    );
    await insertBotActionContext({
      chatId,
      messageId: sent.message_id,
      action: "items_add",
      itemId: null,
      targetChatId: null,
      metadata: null,
    });
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
  //
  // The re-render target depends on the toggled row's `parentItemId`:
  //   - top-level (null)  → /items view (where user came from)
  //   - sub-item          → that parent's sub-items view (keep them
  //                          in the drill-in instead of bouncing out)
  // We capture parentItemId inside the tx — same SELECT we already
  // need — so it's free.
  if (data.startsWith("item:toggle:")) {
    const itemId = data.slice("item:toggle:".length);
    console.log("[cb:toggle]", { chatId, itemId });
    let toggledParentId: string | null = null;
    // Wrapped in an object to defeat TS's narrowing of `let` written
    // only inside a closure (otherwise the post-tx access reads as
    // `never`).
    const captured: { rollup: RollupResult | null } = { rollup: null };
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
        .limit(1);
      if (!current) return;
      toggledParentId = current.parentItemId;
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
      // Mirror complete_item executor: when the toggled row is a
      // checklist child, reconcile the parent's done state in the
      // same tx so the badge in the re-rendered view is correct.
      captured.rollup = await rollupParentDoneState(
        tx,
        updated.id,
        chatId,
        user.id,
      );
    });
    const r = captured.rollup;
    // Toast on rollup flip so the user sees the parent state change
    // — the sub-items view header gains a ✅ on parent too, but a
    // popup is unmissable.
    const toast: string | undefined =
      r && r.flipped && r.parentNowDone === true
        ? locale === "tr"
          ? "✅ Checklist tamamlandı"
          : "✅ Checklist done"
        : r && r.flipped && r.parentNowDone === false
          ? locale === "tr"
            ? "↩️ Checklist tekrar açık"
            : "↩️ Checklist reopened"
          : undefined;
    if (toast) await ctx.answerCallbackQuery({ text: toast });
    else await ctx.answerCallbackQuery();
    if (toggledParentId) {
      const view = await buildSubItemsView(
        toggledParentId,
        chatId,
        locale,
        0,
      );
      await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    } else {
      const view = await buildItemsView(chatId, locale, 0);
      await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    }
    return;
  }

  // item:delete:<itemId> — opens confirmation sheet (no immediate
  // archive). Symmetric with /memory's two-tap delete; matches the
  // chat-side "always ask before deleting" rule.
  if (data.startsWith("item:delete:")) {
    const itemId = data.slice("item:delete:".length);
    const [it] = await db
      .select({ text: items.text })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
      .limit(1);
    if (!it) {
      await ctx.answerCallbackQuery(
        locale === "tr" ? "Bulunamadı." : "Not found.",
      );
      return;
    }
    const title = it.text.length > 60 ? `${it.text.slice(0, 60)}…` : it.text;
    await ctx.answerCallbackQuery();
    await ctx.api.sendMessage(
      chatId,
      locale === "tr"
        ? `🗑️ "${title}" silinsin mi?`
        : `🗑️ Delete "${title}"?`,
      {
        reply_markup: new InlineKeyboard()
          .text(
            locale === "tr" ? "✅ Evet, sil" : "✅ Yes, delete",
            `item:delete_yes:${itemId}`,
          )
          .text(
            locale === "tr" ? "❌ İptal" : "❌ Cancel",
            `item:delete_no:${itemId}`,
          ),
      },
    );
    return;
  }

  if (data.startsWith("item:delete_yes:")) {
    const itemId = data.slice("item:delete_yes:".length);
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
    try {
      await ctx.editMessageText(
        locale === "tr" ? "🗑️ Silindi." : "🗑️ Deleted.",
      );
    } catch {
      // ignore "not modified" / "message can't be edited"
    }
    return;
  }

  if (data.startsWith("item:delete_no:")) {
    await ctx.answerCallbackQuery(
      locale === "tr" ? "İptal" : "Cancelled",
    );
    try {
      await ctx.editMessageText(
        locale === "tr" ? "❌ İptal edildi." : "❌ Cancelled.",
      );
    } catch {
      // ignore
    }
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
        reply_markup: { force_reply: true, selective: !isGroup },
      });
      await insertBotActionContext({
        chatId,
        messageId: sent.message_id,
        action: "attach",
        itemId,
        targetChatId: null,
        metadata: null,
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
      reply_markup: { force_reply: true, selective: !isGroup },
    });
    await insertBotActionContext({
      chatId,
      messageId: sent.message_id,
      action: "attach",
      itemId,
      targetChatId: null,
      metadata: null,
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
          selective: !isGroup,
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
        metadata: null,
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
