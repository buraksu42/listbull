/**
 * Callback handler for `/workspace` picker buttons.
 *
 * callback_data: `wsswitch:<workspace_id>`. The caller IS the user
 * who saw the picker (private DM origin), but we still re-check
 * workspace membership before applying — defense in depth.
 */
import type { Context } from "grammy";

import { getUserByTelegramId } from "@/lib/db/queries/users";
import {
  getWorkspaceMembership,
  setActiveWorkspace,
} from "@/lib/db/queries/workspaces";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleWorkspaceSwitchCallback(
  ctx: Context,
): Promise<void> {
  const cb = ctx.callbackQuery;
  if (!cb || typeof cb.data !== "string") return;
  if (!cb.data.startsWith("wsswitch:")) return;

  const workspaceId = cb.data.slice("wsswitch:".length);
  if (workspaceId.length === 0) {
    await ctx.answerCallbackQuery("Invalid payload.");
    return;
  }

  const user = await getUserByTelegramId(cb.from.id);
  if (!user) {
    await ctx.answerCallbackQuery("Önce /start at.");
    return;
  }
  const locale = pickLocale(user.locale);

  const membership = await getWorkspaceMembership(user.id, workspaceId);
  if (!membership) {
    await ctx.answerCallbackQuery(
      locale === "tr" ? "Üyesi değilsin." : "Not a member.",
    );
    return;
  }

  await setActiveWorkspace(user.id, workspaceId);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    locale === "tr"
      ? "✓ Aktif workspace değiştirildi."
      : "✓ Active workspace switched.",
  );
}
