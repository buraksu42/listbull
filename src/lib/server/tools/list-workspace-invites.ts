/**
 * Executor: `list_workspace_invites` — pending workspace invites for
 * the user's active workspace. Owner + admin only.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import type { ListWorkspaceInvitesOutput } from "@/lib/ai/tools";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { listPendingWorkspaceInvites } from "@/lib/db/queries/workspace-invites";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeListWorkspaceInvites(
  _input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<ListWorkspaceInvitesOutput>> {
  const membership = await getWorkspaceMembership(ctx.userId, ctx.workspaceId);
  if (!membership) {
    return err(ERR.not_found, "Workspace not found.");
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    return err(
      ERR.forbidden,
      "Only owners and admins can list pending invites.",
    );
  }

  const [ws] = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .limit(1);
  if (!ws) {
    return err(ERR.not_found, "Workspace not found.");
  }

  const invites = await listPendingWorkspaceInvites(ctx.workspaceId);
  const botUsername = env.TELEGRAM_BOT_USERNAME;
  return ok({
    workspace: { id: ws.id, name: ws.name },
    pendingInvites: invites.map((inv) => ({
      token: inv.token,
      invitedUsername: inv.invitedUsername,
      role: inv.role as "admin" | "editor" | "viewer" | "guest",
      invitedAt: inv.invitedAt,
      expiresAt: inv.expiresAt,
      deeplink: `https://t.me/${botUsername}?startapp=wsinvite_${inv.token}`,
    })),
  });
}
