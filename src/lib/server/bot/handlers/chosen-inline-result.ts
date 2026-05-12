/**
 * D1+: server-side reaction to inline-result selection.
 *
 * Telegram's `chosen_inline_result` update fires when the user picks
 * an inline result, BEFORE the message goes out. We use it to act on
 * `create:` prefixed result ids — Quick Create from
 * `inline-query.ts`. The host-chat message Telegram inserts is the
 * pre-baked confirmation copy from `input_message_content`; here we
 * actually create the item server-side so the message tells the truth.
 *
 * Selection fires even when the host chat doesn't expose the message
 * back to us (e.g. another user's private chat), so this is the only
 * write opportunity. If create fails, we DM the chooser with the
 * specific error so the user can recover without thinking the
 * inserted message lied.
 *
 * BotFather requirement: `/setinlinefeedback <bot> Enabled` so
 * Telegram routes `chosen_inline_result` updates. The webhook
 * `allowed_updates` list must also include the type.
 */
import "server-only";

import type { Context } from "grammy";

import { ensureInbox } from "@/lib/db/queries/lists";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { executeCreateItem } from "@/lib/server/tools/create-item";
import { decodeIdPayload } from "@/lib/server/bot/handlers/inline-query";

export async function handleChosenInlineResult(ctx: Context): Promise<void> {
  const chosen = ctx.update.chosen_inline_result;
  if (!chosen) return;

  const resultId = chosen.result_id;
  if (!resultId.startsWith("create:")) return; // only Quick Create here

  const tgUserId = chosen.from.id;
  const user = await getUserByTelegramId(tgUserId);
  if (!user) return; // no /start yet; nothing to add to

  const text = decodeIdPayload(resultId.slice("create:".length));
  if (!text || text.length === 0) return;

  // Inbox needs to exist (the user may not have one if they were
  // invited-only). ensureInbox is idempotent — it creates a Personal
  // workspace + Inbox if missing, otherwise returns the existing.
  await ensureInbox(user.id);

  const workspaceId = await resolveActiveWorkspaceId(user.id);

  const result = await executeCreateItem(
    { text, list_name: null },
    { userId: user.id, workspaceId },
  );

  if (!result.ok) {
    // Best-effort DM with the failure — silent for inline since we
    // can't update the inserted host-chat message.
    try {
      await ctx.api.sendMessage(
        tgUserId,
        user.locale === "tr"
          ? `❗️ "${text}" eklenirken hata: ${result.error.message}`
          : `❗️ Couldn't add "${text}": ${result.error.message}`,
      );
    } catch {
      // The chooser may not have started the bot yet; ignore.
    }
  }
}
