/**
 * `/bindgroup` — bind a Telegram group/supergroup to a workspace.
 *
 * Group-context only. The invoker must own at least one workspace.
 * Behavior:
 *   - 0 owned workspaces → group reply telling user to create one.
 *   - 1 owned workspace → auto-bind it, reply in group.
 *   - 2+ owned workspaces → DM user an inline keyboard picker; in
 *     group, briefly tell the user to check their DM.
 *
 * Security: the picker buttons live in DM, so only the invoker can
 * tap them. The bind-callback handler re-verifies ownership before
 * applying the binding.
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";

import {
  bindWorkspaceToChat,
  getWorkspaceByChatId,
  listOwnedWorkspaces,
} from "@/lib/db/queries/workspaces";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleBindGroup(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  const chat = ctx.chat;
  if (!from || !message || !chat) return;

  const isGroup = chat.type === "group" || chat.type === "supergroup";
  if (!isGroup) {
    await ctx.reply(
      "Bu komut grup içinde çalışır. Bot'u eklediğin grup'tan /bindgroup yaz.",
    );
    return;
  }

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply(
      `@${from.username ?? from.first_name} — DM'imden önce /start at, sonra burada tekrar /bindgroup gönder.`,
      { reply_parameters: { message_id: message.message_id } },
    );
    return;
  }

  const locale = pickLocale(user.locale);

  // Already bound? Tell the invoker; let them /unbindgroup first.
  const existing = await getWorkspaceByChatId(chat.id);
  if (existing) {
    await ctx.reply(
      locale === "tr"
        ? `Bu grup zaten "${existing.name}" workspace'i ile bağlı. Önce /unbindgroup ile kaldır.`
        : `This group is already bound to "${existing.name}". Run /unbindgroup first.`,
      { reply_parameters: { message_id: message.message_id } },
    );
    return;
  }

  const owned = await listOwnedWorkspaces(user.id);
  if (owned.length === 0) {
    await ctx.reply(
      locale === "tr"
        ? "Sahibi olduğun bir workspace yok. Mini App'i aç → Workspace → Yeni, sonra burada tekrar /bindgroup gönder."
        : "You don't own any workspace yet. Open the Mini App → Workspace → New, then /bindgroup here again.",
      { reply_parameters: { message_id: message.message_id } },
    );
    return;
  }

  if (owned.length === 1) {
    const ws = owned[0];
    if (!ws) return;
    const result = await bindWorkspaceToChat(ws.id, chat.id);
    if (result.ok) {
      await ctx.reply(
        locale === "tr"
          ? `✓ "${ws.name}" bu grup'a bağlandı. Davet edilmiş üyeler grup'tan @-mention atarak veya bir mesaja reply atıp @${ctx.me.username} <komut> yazarak kullanabilir.`
          : `✓ "${ws.name}" is bound to this group. Invited members can use it by @-mentioning ${ctx.me.username} or replying to a message with @${ctx.me.username} <command>.`,
      );
      return;
    }
    await replyBindError(ctx, result, locale);
    return;
  }

  // 2+ owned workspaces → DM picker.
  const keyboard = new InlineKeyboard();
  for (const ws of owned.slice(0, 8)) {
    keyboard
      .text(
        ws.isPersonal ? `${ws.name} (Personal)` : ws.name,
        `bind:${ws.id}:${chat.id}`,
      )
      .row();
  }
  keyboard.text(locale === "tr" ? "İptal" : "Cancel", `bind:cancel:${chat.id}`);

  try {
    await ctx.api.sendMessage(
      from.id,
      locale === "tr"
        ? `Hangi workspace'i "${chat.title ?? "bu grup"}" grubuna bağlayalım?`
        : `Which workspace should I bind to "${chat.title ?? "this group"}"?`,
      { reply_markup: keyboard },
    );
    await ctx.reply(
      locale === "tr"
        ? `@${from.username ?? from.first_name} — DM'inden hangi workspace olduğunu seç.`
        : `@${from.username ?? from.first_name} — pick the workspace in your DM with me.`,
      { reply_parameters: { message_id: message.message_id } },
    );
  } catch {
    // User hasn't started a DM with the bot — DM send fails. Fall back
    // to in-group instructions.
    await ctx.reply(
      locale === "tr"
        ? `@${from.username ?? from.first_name} — önce DM'imden /start at, sonra burada tekrar /bindgroup yaz.`
        : `@${from.username ?? from.first_name} — DM me /start first, then run /bindgroup here again.`,
      { reply_parameters: { message_id: message.message_id } },
    );
  }
}

async function replyBindError(
  ctx: Context,
  result: { ok: false; code: string } & Record<string, unknown>,
  locale: "tr" | "en",
): Promise<void> {
  let msg: string;
  if (result.code === "chat_in_use") {
    const name = (result as { conflictingWorkspaceName?: string })
      .conflictingWorkspaceName;
    msg =
      locale === "tr"
        ? `Bu grup zaten başka bir workspace'e (${name}) bağlı. O workspace'in sahibi önce /unbindgroup yapmalı.`
        : `This group is already bound to another workspace (${name}). Its owner must /unbindgroup first.`;
  } else if (result.code === "workspace_in_use") {
    msg =
      locale === "tr"
        ? "Bu workspace zaten başka bir grupla bağlı. Workspace başına tek grup."
        : "This workspace is already bound to a different group. One workspace, one group.";
  } else {
    msg =
      locale === "tr"
        ? "Bağlama başarısız oldu, tekrar dene."
        : "Bind failed; try again.";
  }
  await ctx.reply(msg);
}
