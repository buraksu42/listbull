/**
 * Executor: `invite_to_workspace` — Phase 4.5 schema-level shell.
 *
 * Phase 4.5 acceptable behaviors:
 *  - already-member detection: the target user is in workspace_members
 *    → return `already_member`, no DB write
 *  - Free tier or Personal Workspace → return `pending_phase_5` and
 *    let tier middleware log the attempt
 *  - Otherwise → real invite flow (token + DM) lands in Phase 5; for
 *    now we return `pending_phase_5` even on shared workspaces since
 *    no creation UI exists yet
 *
 * Owner / admin gate is wired now so Phase 5 only needs to swap the
 * "pending_phase_5" branch with token issuance.
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users, workspaceMembers, workspaces } from "@/lib/db/schema";
import {
  inviteToWorkspaceInputSchema,
  type InviteToWorkspaceOutput,
} from "@/lib/ai/tools";
import { enforceTier } from "@/lib/server/middleware/tier-enforce";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
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
      isPersonal: workspaces.isPersonal,
    })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .limit(1);
  if (!workspace) {
    return err(ERR.not_found, "Workspace not found.");
  }

  // Already-member detection (when invitee is a known user).
  const [invitee] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.telegramUsername}) = ${lowered}`)
    .limit(1);

  if (invitee) {
    const existing = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        eq(workspaceMembers.userId, invitee.id),
      ),
    });
    if (existing) {
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

  // Tier check. Phase 4.5 logs only — Phase 5 enforces.
  const memberCount = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
  )[0]?.count ?? 0;

  await enforceTier(ctx.workspaceId, {
    type: "invite_member",
    currentMemberCount: memberCount,
  });

  // Phase 4.5: schema-only. Real invite flow (token + DM) ships in
  // Phase 5 alongside white-label bot wiring + tier enforcement.
  return ok({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    },
    invitedUsername: lowered,
    role,
    status: "pending_phase_5",
    warnings: [
      "workspace_invites_phase_5",
      ...(workspace.isPersonal ? ["personal_workspace_no_invite"] : []),
    ],
  });
}
