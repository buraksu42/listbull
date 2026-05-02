/**
 * Executor: `share_list` (Phase 3).
 *
 * Owner-only invite creation:
 *   - Resolve target list (no Inbox fallback; Inbox cannot be shared).
 *   - Reject if caller is not the owner.
 *   - Idempotency: reuse a pending non-expired invite for
 *     `(list_id, lowered_username)` instead of creating duplicates.
 *   - Idempotency #2: if the invitee is already a member, return
 *     `alreadyMember: true` and skip both the row and the DM.
 *   - Generate 32-byte CSPRNG token (Inv-10), INSERT list_invites.
 *   - Best-effort DM the invitee with the deeplink. DM failure → warning
 *     `invitee_dm_failed`; the invite row remains valid (Inv-13: no
 *     activity_log row at invite time).
 *
 * The invite token is NEVER logged.
 */
import "server-only";

import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { listInvites, listMembers, lists, users } from "@/lib/db/schema";
import {
  shareListInputSchema,
  type ShareListOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, resolveList } from "./_shared";
import { findPendingInvite } from "@/lib/db/queries/invites";
import { isListOwner } from "@/lib/db/queries/members";
import { getBot } from "@/lib/server/bot";
import { escapeMarkdownV2 } from "@/lib/server/bot/escape-markdown";
import { pickLocale } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";

import type { ExecResult } from "./_shared";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

function buildDeeplink(token: string): string {
  // `startapp` lets the Mini App receive `invite_<token>` and route to
  // the accept screen. The web fallback URL is also fine; we serve the
  // same path off the app domain.
  return `${env.NEXT_PUBLIC_APP_URL}/invites/${token}`;
}

export async function executeShareList(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<ShareListOutput>> {
  const parsed = shareListInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { username, list_id, list_name, role } = parsed.data;

  const lowered = normalizeUsername(username);
  if (lowered.length === 0) {
    return err(ERR.invalid_input, "username is required");
  }

  // List resolution. NO inbox fallback (cannot share inbox).
  const resolution = await resolveList(
    ctx.userId,
    { listId: list_id, listName: list_name },
    { inboxFallback: false },
  );
  switch (resolution.kind) {
    case "forbidden":
      return err(ERR.forbidden, "You don't have access to that list.");
    case "not_found":
      return err(ERR.not_found, "No matching list found.");
    case "ambiguous": {
      const names = resolution.candidates.map((c) => c.name).join(", ");
      return err(
        ERR.ambiguous_list,
        `List name matched multiple lists: ${names}. Specify which one.`,
      );
    }
  }

  // Inbox cannot be shared.
  const [listRow] = await db
    .select({
      id: lists.id,
      name: lists.name,
      emoji: lists.emoji,
      isInbox: lists.isInbox,
      ownerId: lists.ownerId,
    })
    .from(lists)
    .where(eq(lists.id, resolution.listId))
    .limit(1);
  if (!listRow) {
    return err(ERR.not_found, "List not found.");
  }
  if (listRow.isInbox) {
    return err("cannot_share_inbox", "Inbox lists cannot be shared.");
  }

  // Owner-only.
  const isOwner = await isListOwner(resolution.listId, ctx.userId);
  if (!isOwner) {
    return err(ERR.forbidden, "Only the list owner can share.");
  }

  // Self-invite check.
  const [callerRow] = await db
    .select({
      telegramUsername: users.telegramUsername,
      telegramFirstName: users.telegramFirstName,
    })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);
  if (
    callerRow?.telegramUsername &&
    callerRow.telegramUsername.toLowerCase() === lowered
  ) {
    return err(ERR.invalid_input, "You cannot invite yourself.");
  }

  // If the invitee is already a known user AND already a member, return
  // alreadyMember: true with NO new invite.
  const [invitee] = await db
    .select({
      id: users.id,
      telegramId: users.telegramId,
      locale: users.locale,
      telegramFirstName: users.telegramFirstName,
    })
    .from(users)
    .where(sql`lower(${users.telegramUsername}) = ${lowered}`)
    .limit(1);

  if (invitee) {
    const member = await db.query.listMembers.findFirst({
      where: and(
        eq(listMembers.listId, resolution.listId),
        eq(listMembers.userId, invitee.id),
      ),
    });
    if (member) {
      return ok({
        invite: {
          // Shape consistency only — caller must not surface this.
          token: "",
          expiresAt: new Date().toISOString(),
          deeplink: "",
          role,
        },
        list: {
          id: listRow.id,
          name: listRow.name,
          emoji: listRow.emoji,
        },
        invitedUsername: lowered,
        alreadyMember: true,
      });
    }
  }

  // Idempotency: re-use a pending non-expired invite if present.
  let inviteToken: string;
  let expiresAt: Date;
  let inviteRole: "editor" | "viewer";

  const pending = await findPendingInvite(resolution.listId, lowered);
  if (pending) {
    inviteToken = pending.token;
    expiresAt = pending.expiresAt;
    inviteRole = (pending.role as "editor" | "viewer") ?? role;
  } else {
    inviteToken = randomBytes(32).toString("base64url");
    expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    inviteRole = role;
    await db.insert(listInvites).values({
      listId: resolution.listId,
      invitedUsername: lowered,
      invitedBy: ctx.userId,
      token: inviteToken,
      role: inviteRole,
      expiresAt,
    });
  }

  const deeplink = buildDeeplink(inviteToken);
  const warnings: string[] = [];

  // Best-effort DM the invitee. We only attempt the DM if we have a
  // user row with a known telegramId; otherwise the user has not yet
  // started the bot and can only paste the link from the inviter.
  if (invitee?.telegramId) {
    try {
      const bot = getBot();
      const locale = pickLocale(invitee.locale);
      const inviterName = callerRow?.telegramFirstName ?? "Someone";
      const listEmoji = listRow.emoji ?? "📋";
      const listName = listRow.name;
      const body =
        locale === "tr"
          ? `${escapeMarkdownV2(`${listEmoji} ${listName}`)}\n\n` +
            `*${escapeMarkdownV2(inviterName)}* seni bu listeye davet etti\\.\n\n` +
            `[Daveti aç](${deeplink})`
          : `${escapeMarkdownV2(`${listEmoji} ${listName}`)}\n\n` +
            `*${escapeMarkdownV2(inviterName)}* invited you to this list\\.\n\n` +
            `[Open invite](${deeplink})`;
      await bot.api.sendMessage(invitee.telegramId, body, {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      // 403 (bot not started) is the common case. Token already stored;
      // the inviter can paste the link manually.
      console.warn(
        "[share_list] invitee DM failed",
        // Do NOT log the token.
        { listId: listRow.id, invitedUsername: lowered, error: String(error) },
      );
      warnings.push("invitee_dm_failed");
    }
  } else {
    // Invitee not in users table yet → DM is impossible. Surface the
    // same warning so the LLM can phrase the reply appropriately.
    warnings.push("invitee_dm_failed");
  }

  // Note: the AI's frozen schema doesn't declare `warnings`, but Inv-14
  // mandates `invitee_dm_failed` as an output warning. We attach it as
  // an extra field; the orchestrator JSON-serializes the result and the
  // LLM sees both. (Contract gap flagged in the Backend-agent report.)
  const baseResult: ShareListOutput = {
    invite: {
      token: inviteToken,
      expiresAt: expiresAt.toISOString(),
      deeplink,
      role: inviteRole,
    },
    list: {
      id: listRow.id,
      name: listRow.name,
      emoji: listRow.emoji,
    },
    invitedUsername: lowered,
  };
  if (warnings.length > 0) {
    return ok({ ...baseResult, warnings });
  }
  return ok(baseResult);
}
