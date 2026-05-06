/**
 * Executor: `invite_to_workspace` — Phase 5.5 real flow.
 *
 * Workspace owner / admin invites a user to the active workspace.
 * Mirrors `share_list`'s shape (token + 7d TTL + DM deeplink) but
 * scoped to workspace membership (workspace_members + workspace_invites).
 *
 * Behavior:
 *  - already-member detection → `already_member`, no row written
 *  - tier gate via enforceTier(invite_member) — Phase 5 logs only,
 *    Phase 5+ flips to active 402
 *  - idempotency: re-tap with same (workspace, lowered_username)
 *    returns the existing pending invite token instead of duplicating
 *  - DM via the workspace's primary white-label bot if registered,
 *    else default platform bot. invitee_dm_failed warning when
 *    Telegram returns 403 (bot not started).
 */
import "server-only";

import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  bots,
  users,
  workspaceBots,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import {
  inviteToWorkspaceInputSchema,
  type InviteToWorkspaceOutput,
} from "@/lib/ai/tools";
import { enforceTier } from "@/lib/server/middleware/tier-enforce";
import { getBot, getBotById } from "@/lib/server/bot";
import { escapeMarkdownV2 } from "@/lib/server/bot/escape-markdown";
import { pickLocale } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

function buildDeeplink(token: string): string {
  return `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=wsinvite_${token}`;
}

export async function executeInviteToWorkspace(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<InviteToWorkspaceOutput>> {
  const parsed = inviteToWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { username, role } = parsed.data;
  const lowered = normalizeUsername(username);
  if (lowered.length === 0) {
    return err(ERR.invalid_input, "username is required");
  }

  // Caller's role gate: owner or admin.
  const callerMember = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, ctx.workspaceId),
      eq(workspaceMembers.userId, ctx.userId),
    ),
  });
  if (!callerMember) {
    return err(ERR.not_found, "Workspace not found.");
  }
  if (callerMember.role !== "owner" && callerMember.role !== "admin") {
    return err(ERR.forbidden, "Only owners and admins can invite members.");
  }

  // Workspace info.
  const [workspace] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      tier: workspaces.tier,
      isPersonal: workspaces.isPersonal,
    })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .limit(1);
  if (!workspace) {
    return err(ERR.not_found, "Workspace not found.");
  }
  if (workspace.isPersonal) {
    return err(
      "personal_workspace_no_invite",
      "Personal workspace cannot have additional members.",
    );
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

  // Already-member detection.
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
    const member = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        eq(workspaceMembers.userId, invitee.id),
      ),
    });
    if (member) {
      return ok({
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
        invitedUsername: lowered,
        role,
        status: "already_member",
      });
    }
  }

  // Tier check (logs in Phase 4.5; rejects in Phase 5+ with
  // BILLING_ENFORCE=true).
  const memberCount =
    (
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
    )[0]?.count ?? 0;

  const tierResult = await enforceTier(ctx.workspaceId, {
    type: "invite_member",
    currentMemberCount: memberCount,
  });
  if (tierResult.enforced) {
    return err(
      tierResult.reason,
      tierResult.message,
    );
  }

  // Idempotency: reuse a pending non-expired invite if present.
  let inviteToken: string;
  let expiresAt: Date;
  let inviteRole = role;

  const [pending] = await db
    .select({
      id: workspaceInvites.id,
      token: workspaceInvites.token,
      role: workspaceInvites.role,
      expiresAt: workspaceInvites.expiresAt,
    })
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, ctx.workspaceId),
        eq(workspaceInvites.invitedUsername, lowered),
        sql`${workspaceInvites.acceptedAt} IS NULL`,
        sql`${workspaceInvites.expiresAt} > now()`,
      ),
    )
    .limit(1);

  if (pending) {
    inviteToken = pending.token;
    expiresAt = pending.expiresAt;
    inviteRole = pending.role as typeof role;
  } else {
    inviteToken = randomBytes(32).toString("base64url");
    expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await db.insert(workspaceInvites).values({
      workspaceId: ctx.workspaceId,
      invitedUsername: lowered,
      invitedBy: ctx.userId,
      token: inviteToken,
      role,
      expiresAt,
    });
  }

  const deeplink = buildDeeplink(inviteToken);
  const warnings: string[] = [];

  // DM via the workspace's primary white-label bot if registered;
  // else default platform bot. Same pattern as reminder dispatch.
  if (invitee?.telegramId) {
    const [primaryBotRow] = await db
      .select({ id: bots.id })
      .from(workspaceBots)
      .innerJoin(bots, eq(bots.id, workspaceBots.botId))
      .where(
        and(
          eq(workspaceBots.workspaceId, ctx.workspaceId),
          eq(workspaceBots.isPrimary, true),
          eq(bots.isDefault, false),
        ),
      )
      .limit(1);

    let bot: Awaited<ReturnType<typeof getBot>>;
    if (primaryBotRow) {
      const wsBot = await getBotById(primaryBotRow.id);
      bot = wsBot ?? (await getBot());
    } else {
      bot = await getBot();
    }

    try {
      const locale = pickLocale(invitee.locale);
      const inviterName = callerRow?.telegramFirstName ?? "Someone";
      const wsName = workspace.name;
      const body =
        locale === "tr"
          ? `*${escapeMarkdownV2(wsName)}*\n\n` +
            `*${escapeMarkdownV2(inviterName)}* seni bu workspace'e davet etti\\.\n\n` +
            `[Daveti aç](${deeplink})`
          : `*${escapeMarkdownV2(wsName)}*\n\n` +
            `*${escapeMarkdownV2(inviterName)}* invited you to this workspace\\.\n\n` +
            `[Open invite](${deeplink})`;
      await bot.api.sendMessage(invitee.telegramId, body, {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.warn("[invite_to_workspace] DM failed", {
        workspaceId: ctx.workspaceId,
        invitedUsername: lowered,
        error: String(error),
      });
      warnings.push("invitee_dm_failed");
    }
  } else {
    warnings.push("invitee_dm_failed");
  }

  return ok({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    },
    invitedUsername: lowered,
    role: inviteRole,
    status: "invite_sent",
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}
