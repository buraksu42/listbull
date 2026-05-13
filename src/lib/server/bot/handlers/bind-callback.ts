/**
 * Callback handler for `/bindgroup` workspace picker buttons.
 *
 * Buttons are sent via DM (see commands/bind-group.ts), so the tap
 * always comes from the original invoker. We re-verify workspace
 * ownership before applying the bind (defense in depth — protects
 * against stale DM message stays around forever).
 *
 * callback_data format: `bind:<workspace_id>:<chat_id>` or
 * `bind:cancel:<chat_id>`. The handler answers the callback to clear
 * the loading spinner, then edits the DM message with the outcome.
 */
import type { Context } from "grammy";

import { buildBindSuccessGroupMessage } from "@/lib/server/bot/commands/bind-group";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import {
  bindWorkspaceToChat,
  listOwnedWorkspaces,
} from "@/lib/db/queries/workspaces";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleBindCallback(ctx: Context): Promise<void> {
  const cb = ctx.callbackQuery;
  if (!cb || typeof cb.data !== "string") return;
  if (!cb.data.startsWith("bind:")) return;

  const parts = cb.data.split(":");
  if (parts.length !== 3) {
    await ctx.answerCallbackQuery("Invalid payload.");
    return;
  }
  const [, workspaceIdOrCancel, chatIdStr] = parts;
  if (workspaceIdOrCancel === undefined || chatIdStr === undefined) {
    await ctx.answerCallbackQuery("Invalid payload.");
    return;
  }
  const chatId = Number.parseInt(chatIdStr, 10);
  if (!Number.isFinite(chatId)) {
    await ctx.answerCallbackQuery("Invalid chat id.");
    return;
  }

  const user = await getUserByTelegramId(cb.from.id);
  if (!user) {
    await ctx.answerCallbackQuery("Run /start in DM first.");
    return;
  }
  const locale = pickLocale(user.locale);

  if (workspaceIdOrCancel === "cancel") {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      locale === "tr" ? "İptal edildi." : "Cancelled.",
    );
    return;
  }

  // Verify ownership: the picker only shows owned workspaces, but the
  // DM message could be stale (workspace deleted, ownership transferred).
  const owned = await listOwnedWorkspaces(user.id);
  const ws = owned.find((w) => w.id === workspaceIdOrCancel);
  if (!ws) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      locale === "tr"
        ? "Bu workspace'in sahibi değilsin (silinmiş olabilir)."
        : "You don't own this workspace anymore (maybe deleted).",
    );
    return;
  }

  const result = await bindWorkspaceToChat(ws.id, chatId);
  if (!result.ok) {
    await ctx.answerCallbackQuery();
    const msg =
      result.code === "chat_in_use"
        ? locale === "tr"
          ? `Bu grup zaten "${result.conflictingWorkspaceName}" ile bağlı. Önce sahibi /unbindgroup yapmalı.`
          : `This group is already bound to "${result.conflictingWorkspaceName}". Its owner must /unbindgroup first.`
        : result.code === "workspace_in_use"
          ? locale === "tr"
            ? "Bu workspace zaten başka bir grupla bağlı. Workspace başına tek grup."
            : "This workspace is already bound to another group. One workspace, one group."
          : locale === "tr"
            ? "Bağlama başarısız oldu, tekrar dene."
            : "Bind failed; try again.";
    await ctx.editMessageText(msg);
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    locale === "tr"
      ? `✓ "${ws.name}" gruba bağlandı. Davet edilmiş üyeler artık grup'tan @${ctx.me.username} mention'ı ile kullanabilir.`
      : `✓ "${ws.name}" is bound to the group. Invited members can now use @${ctx.me.username} from the group.`,
  );

  // Also confirm in-group so non-invokers see the binding happened.
  // The group message includes the join link so anyone in the chat
  // can tap to join the workspace as editor.
  try {
    const msg = await buildBindSuccessGroupMessage(ws.id, ws.name, locale);
    await ctx.api.sendMessage(chatId, msg, {
      link_preview_options: { is_disabled: true },
    });
  } catch {
    // Bot may have been kicked from the group between the picker and
    // the callback. The bind is still recorded; the in-group ping is
    // best-effort.
  }
}
