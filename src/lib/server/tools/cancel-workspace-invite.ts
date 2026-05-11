/**
 * Executor: `cancel_workspace_invite` — revoke a pending workspace
 * invite. Owner + admin only. PENDING-only; surfaces
 * `invite_already_accepted` when caller should pivot to
 * `remove_workspace_member`.
 */
import "server-only";

import {
  cancelWorkspaceInviteInputSchema,
  type CancelWorkspaceInviteOutput,
} from "@/lib/ai/tools";
import { cancelPendingWorkspaceInvite } from "@/lib/db/queries/workspace-invites";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeCancelWorkspaceInvite(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<CancelWorkspaceInviteOutput>> {
  const parsed = cancelWorkspaceInviteInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }

  const membership = await getWorkspaceMembership(ctx.userId, ctx.workspaceId);
  if (!membership) {
    return err(ERR.not_found, "Workspace not found.");
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    return err(
      ERR.forbidden,
      "Only owners and admins can cancel workspace invites.",
    );
  }

  const result = await cancelPendingWorkspaceInvite(
    ctx.workspaceId,
    parsed.data.username,
  );
  if (!result.ok) {
    return err(result.code, result.message);
  }

  return ok({
    workspace: {
      id: result.workspaceId,
      name: result.workspaceName,
    },
    invitedUsername: result.invitedUsername,
    cancelledInviteId: result.cancelledInviteId,
  });
}
