import type { Context } from "grammy";

import { env } from "@/lib/env";
import { acceptListJoinLink, ensureInbox } from "@/lib/db/queries/lists";
import { upsertUserFromTelegram } from "@/lib/db/queries/users";
import { acceptWorkspaceInvite } from "@/lib/db/queries/workspace-invites";
import {
  acceptWorkspaceJoinLink,
  setActiveWorkspace,
} from "@/lib/db/queries/workspaces";
import { pickLocale, t } from "@/lib/server/bot/i18n";

/**
 * `/start` handler — onboarding + Inbox creation. As of 2026-05-08
 * also handles the `?start=<payload>` deep-link param so users who
 * arrive via an invite-accept flow see a contextual welcome instead
 * of the generic onboarding text.
 *
 * Recognized payloads:
 *   - `joined_<listId>` — the user just accepted an invite to that
 *     list. Welcome them + offer a Mini App deeplink to that list.
 *
 * Unrecognized payloads fall through to the default welcome.
 */
export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await upsertUserFromTelegram({
    telegramId: from.id,
    telegramUsername: from.username ?? null,
    telegramFirstName: from.first_name,
    telegramLastName: from.last_name ?? null,
    telegramPhotoUrl: null,
    languageCode: from.language_code ?? null,
  });

  // ensureInbox is deferred until after the payload branches — invited
  // users (wsinvite_/joined_) don't need an auto-created Personal
  // workspace; they're being added to someone else's workspace and
  // surfacing an extra empty Personal in the switcher is just
  // clutter. Only the plain /start path (no payload) creates Personal.

  const locale = pickLocale(user.locale);
  const tr = t(locale);

  // grammY's bot.command("start") populates ctx.match with the
  // text after the command (i.e. the deep-link payload from
  // ?start=<payload>).
  const payload =
    typeof (ctx as unknown as { match?: unknown }).match === "string"
      ? ((ctx as unknown as { match: string }).match || "").trim()
      : "";

  // List join-link payload (Phase 16/#29): username-less invite to a
  // specific list. Caller must already be a workspace member; if not,
  // we surface a "ask the workspace owner first" hint.
  if (payload.startsWith("joinlist_")) {
    const token = payload.slice("joinlist_".length);
    const result = await acceptListJoinLink(token, user.id);
    if (result.ok) {
      await setActiveWorkspace(user.id, result.workspaceId);
      const miniAppUrl = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=list_${result.listId}`;
      const msg =
        locale === "tr"
          ? result.alreadyMember
            ? `"${result.listName}" listesinin zaten üyesisin. Mini App: ${miniAppUrl}`
            : `Hoş geldin! "${result.listName}" listesine editor olarak katıldın. Mini App: ${miniAppUrl}`
          : result.alreadyMember
            ? `You're already a member of "${result.listName}". Mini App: ${miniAppUrl}`
            : `Welcome! You joined "${result.listName}" as an editor. Mini App: ${miniAppUrl}`;
      await ctx.reply(msg);
      return;
    }
    await ctx.reply(
      locale === "tr"
        ? result.code === "not_workspace_member"
          ? "Önce workspace üyesi olman gerek. Workspace sahibinden davet iste."
          : "Bu davet linki geçersiz veya kaldırılmış."
        : result.code === "not_workspace_member"
          ? "You need to join the workspace first. Ask the workspace owner for an invite."
          : "This invite link is invalid or removed.",
    );
    return;
  }

  // Group join-link payload: anyone with the link taps to join the
  // workspace as editor. Multi-use; the token persists for the
  // lifetime of the group binding.
  if (payload.startsWith("joinws_")) {
    const token = payload.slice("joinws_".length);
    const result = await acceptWorkspaceJoinLink(token, user.id);
    if (result.ok) {
      await setActiveWorkspace(user.id, result.workspaceId);
      const miniAppUrl = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=`;
      const msg =
        locale === "tr"
          ? result.alreadyMember
            ? `Zaten "${result.workspaceName}" workspace'inin üyesisin. Mini App: ${miniAppUrl}`
            : `Hoş geldin! "${result.workspaceName}" workspace'ine editor olarak katıldın. Mini App: ${miniAppUrl}`
          : result.alreadyMember
            ? `You're already a member of "${result.workspaceName}". Mini App: ${miniAppUrl}`
            : `Welcome! You joined "${result.workspaceName}" as an editor. Mini App: ${miniAppUrl}`;
      await ctx.reply(msg);
      return;
    }
    await ctx.reply(
      locale === "tr"
        ? "Bu davet linki geçersiz veya iptal edilmiş."
        : "This invite link is invalid or revoked.",
    );
    return;
  }

  if (payload.startsWith("joined_")) {
    const listId = payload.slice("joined_".length);
    const miniAppUrl = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=list_${listId}`;
    const greeting =
      locale === "tr"
        ? `Hoş geldin, ${user.telegramFirstName}! Listeyi açmak için: ${miniAppUrl}`
        : `Welcome, ${user.telegramFirstName}! Open the list: ${miniAppUrl}`;
    await ctx.reply(greeting);
    return;
  }

  // Workspace invite deeplink — when Telegram's `?startapp=` falls
  // back to opening the bot chat (instead of the Mini App), the
  // payload arrives here as the /start parameter. Without this branch
  // the user would see the generic welcome and the invite would
  // never get accepted — the workspace_invites row stays pending
  // and the user wonders why the bot says "Workspace owner needs to
  // set the OpenRouter API key".
  if (payload.startsWith("wsinvite_")) {
    const token = payload.slice("wsinvite_".length);
    const result = await acceptWorkspaceInvite(token, user.id);
    if (result.ok) {
      await setActiveWorkspace(user.id, result.workspaceId);
      const miniAppUrl = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=`;
      const msg =
        locale === "tr"
          ? result.alreadyAccepted
            ? `Bu workspace'in zaten üyesisin. Mini App: ${miniAppUrl}`
            : `Davet kabul edildi — yeni workspace artık aktif. Mini App: ${miniAppUrl}`
          : result.alreadyAccepted
            ? `You're already a member of this workspace. Mini App: ${miniAppUrl}`
            : `Invite accepted — the new workspace is now active. Mini App: ${miniAppUrl}`;
      await ctx.reply(msg);
      return;
    }
    // Map error codes to user-friendly Turkish/English copy.
    const errCopy = (() => {
      switch (result.code) {
        case "not_found":
          return locale === "tr"
            ? "Bu davet linki geçersiz ya da kaldırılmış."
            : "This invite link is invalid or removed.";
        case "invite_already_accepted":
          return locale === "tr"
            ? "Bu davet zaten kabul edilmiş."
            : "This invite was already accepted.";
        case "invite_expired":
          return locale === "tr"
            ? "Bu davetin süresi dolmuş. Davet eden kişiden yenisini iste."
            : "This invite expired. Ask the inviter for a new one.";
        case "invite_username_mismatch":
          return locale === "tr"
            ? `Bu davet @${result.code} adlı kullanıcı için. Senin Telegram username'inle eşleşmiyor.`
            : "This invite was sent to a different Telegram username.";
        default:
          return locale === "tr"
            ? `Davet kabul edilemedi: ${result.message}`
            : `Couldn't accept invite: ${result.message}`;
      }
    })();
    await ctx.reply(errCopy);
    return;
  }

  // Plain /start (no recognized payload). Create the Personal
  // workspace + Inbox now so the user has somewhere to start.
  await ensureInbox(user.id);

  // Plain text (no parse_mode) — MarkdownV2 reserved characters (!, ., -, etc.)
  // would all need escaping which makes the welcome copy unreadable in source.
  // Phase 2 LLM router (handle-message.ts) already settled on plain text;
  // /start now matches that convention.
  const text = tr.welcome(user.telegramFirstName, user.timezone);

  await ctx.reply(text);
}
