/**
 * Workspace invite query helpers (Phase 5.5). Mirrors
 * `src/lib/db/queries/invites.ts` shape (per-list invite flow);
 * differences: workspace_id in place of list_id; accept inserts
 * `workspace_members` and writes a `workspace_member_added`
 * activity_log row.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import type { WorkspaceInvite, WorkspaceRole } from "@/lib/types";

export type WorkspaceInviteContext = {
  invite: WorkspaceInvite;
  workspace: {
    id: string;
    name: string;
    tier: string;
  };
  invitedByName: string;
};

export async function getWorkspaceInviteContextByToken(
  token: string,
): Promise<WorkspaceInviteContext | undefined> {
  const rows = await db
    .select({
      invite: workspaceInvites,
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        tier: workspaces.tier,
      },
      invitedByName: users.telegramFirstName,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .innerJoin(users, eq(users.id, workspaceInvites.invitedBy))
    .where(eq(workspaceInvites.token, token))
    .limit(1);

  return rows[0];
}

export type AcceptWorkspaceInviteResult =
  | { ok: true; workspaceId: string; alreadyAccepted: boolean }
  | { ok: false; code: string; message: string; workspaceId?: string };

/**
 * Atomic accept transaction:
 *   1. SELECT FOR UPDATE on the invite (serialize concurrent accepts).
 *   2. Validate accepted_at IS NULL → invite_already_accepted
 *   3. Validate expires_at > NOW() → invite_expired
 *   4. Validate caller's telegramUsername matches invitedUsername
 *   5. INSERT workspace_members (or recover if user is already in)
 *   6. UPDATE workspace_invites SET accepted_at, accepted_by_user_id
 *   7. INSERT activity_log row workspace_member_added
 */
export async function acceptWorkspaceInvite(
  token: string,
  callerId: string,
): Promise<AcceptWorkspaceInviteResult> {
  return await db.transaction(async (tx) => {
    const lockedRows = await tx.execute<{
      id: string;
      workspace_id: string;
      invited_username: string;
      invited_by: string;
      role: string;
      expires_at: Date;
      accepted_at: Date | null;
      accepted_by_user_id: string | null;
    }>(
      sql`SELECT id, workspace_id, invited_username, invited_by, role, expires_at, accepted_at, accepted_by_user_id
          FROM workspace_invites
          WHERE token = ${token}
          FOR UPDATE`,
    );
    const inviteRow = lockedRows[0];
    if (!inviteRow) {
      return { ok: false, code: "not_found", message: "Invite not found." };
    }

    if (inviteRow.accepted_at) {
      return {
        ok: false,
        code: "invite_already_accepted",
        message: "This invite has already been accepted.",
        workspaceId: inviteRow.workspace_id,
      };
    }

    const now = new Date();
    if (inviteRow.expires_at < now) {
      return {
        ok: false,
        code: "invite_expired",
        message: "This invite has expired.",
      };
    }

    const [caller] = await tx
      .select({
        id: users.id,
        telegramUsername: users.telegramUsername,
        telegramFirstName: users.telegramFirstName,
      })
      .from(users)
      .where(eq(users.id, callerId))
      .limit(1);
    if (!caller) {
      return { ok: false, code: "not_found", message: "Caller not found." };
    }
    const callerLowered = (caller.telegramUsername ?? "").toLowerCase();
    if (
      callerLowered.length === 0 ||
      callerLowered !== inviteRow.invited_username
    ) {
      return {
        ok: false,
        code: "invite_username_mismatch",
        message: "This invite was sent to a different Telegram username.",
      };
    }

    const existingMember = await tx.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, inviteRow.workspace_id),
        eq(workspaceMembers.userId, callerId),
      ),
    });

    if (!existingMember) {
      await tx.insert(workspaceMembers).values({
        workspaceId: inviteRow.workspace_id,
        userId: callerId,
        role: inviteRow.role as WorkspaceRole,
        invitedBy: inviteRow.invited_by,
      });
    }

    await tx
      .update(workspaceInvites)
      .set({
        acceptedAt: now,
        acceptedByUserId: callerId,
      })
      .where(eq(workspaceInvites.id, inviteRow.id));

    if (!existingMember) {
      await tx.insert(activityLog).values({
        listId: null,
        entityType: "workspace",
        entityId: inviteRow.workspace_id,
        action: "workspace_member_added",
        actorId: callerId,
        payloadBefore: null,
        payloadAfter: {
          workspaceId: inviteRow.workspace_id,
          userId: callerId,
          role: inviteRow.role,
          invitedBy: inviteRow.invited_by,
          acceptedAt: now.toISOString(),
        },
      });
    }

    return {
      ok: true,
      workspaceId: inviteRow.workspace_id,
      alreadyAccepted: !!existingMember,
    };
  });
}
