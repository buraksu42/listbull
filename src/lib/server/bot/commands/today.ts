/**
 * `/today` — workspace-scoped daily task list (Phase 16/#27).
 *
 * Works in both private DM (uses caller's active workspace) and group
 * (uses bound workspace). Renders three buckets:
 *   - ⏰ Due today
 *   - ⚠️ Overdue (last 7 days)
 *   - 👥 Assigned, open (no deadline or future)
 *
 * In groups: workspace must be bound (`/bindgroup`) AND caller must
 * be a workspace member.
 */
import type { Context } from "grammy";

import { getUserByTelegramId } from "@/lib/db/queries/users";
import {
  getWorkspaceByChatId,
  getWorkspaceMembership,
  resolveActiveWorkspaceId,
} from "@/lib/db/queries/workspaces";
import { getWorkspaceDailyDigest } from "@/lib/db/queries/workspace-digest";
import { pickLocale } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";
import { renderDailyDigest } from "@/lib/server/bot/digest-format";

export async function handleToday(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || !chat) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Önce /start at.");
    return;
  }
  const locale = pickLocale(user.locale);

  const isGroup = chat.type === "group" || chat.type === "supergroup";

  let workspaceId: string;
  let workspaceName: string;
  if (isGroup) {
    const bound = await getWorkspaceByChatId(chat.id);
    if (!bound) {
      await ctx.reply(
        locale === "tr"
          ? "Bu grup henüz bir workspace'e bağlı değil. /bindgroup ile bağla."
          : "This group isn't bound to a workspace yet. Run /bindgroup.",
      );
      return;
    }
    const membership = await getWorkspaceMembership(user.id, bound.id);
    if (!membership) {
      await ctx.reply(
        locale === "tr"
          ? "Bu workspace'in üyesi değilsin."
          : "You're not a member of this workspace.",
      );
      return;
    }
    workspaceId = bound.id;
    workspaceName = bound.name;
  } else {
    workspaceId = await resolveActiveWorkspaceId(user.id);
    // We don't have the name handy without an extra query; for DM the
    // workspace name is less important since the user is in their own
    // context.
    workspaceName = locale === "tr" ? "Aktif workspace" : "Active workspace";
  }

  const digest = await getWorkspaceDailyDigest({
    userId: user.id,
    workspaceId,
    timezone: user.timezone,
  });

  const text = renderDailyDigest({
    digest,
    workspaceName,
    timezone: user.timezone,
    locale,
    botUsername: env.TELEGRAM_BOT_USERNAME,
  });

  await ctx.reply(text, {
    link_preview_options: { is_disabled: true },
  });
}
