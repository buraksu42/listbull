/**
 * Executor: `remove_workspace_member` — kick a member off the active
 * workspace (owner-only). Cascades:
 *   1. DELETE workspace_members row
 *   2. DELETE list_members rows for every list in the workspace where
 *      the removed user had a per-list membership
 *   3. UPDATE items SET assignee_id = NULL for items in the
 *      workspace's lists assigned to the removed user (Inv-12 analog)
 *   4. INSERT activity_log row `workspace_member_removed` (Phase 4.5
 *      activity action extension)
 *
 * Cannot remove the workspace owner via this tool — `update_workspace`
 * (Phase 5+) ships ownership transfer separately.
 */
import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  items,
  listMembers,
  lists,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import {
  removeWorkspaceMemberInputSchema,
  type RemoveWorkspaceMemberOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeRemoveWorkspaceMember(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<RemoveWorkspaceMemberOutput>> {
  const parsed = removeWorkspaceMemberInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { username, user_id } = parsed.data;

  // Caller must be workspace owner.
  const callerMember = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, ctx.workspaceId),
      eq(workspaceMembers.userId, ctx.userId),
    ),
  });
  if (!callerMember) {
    return err(ERR.not_found, "Workspace not found.");
  }
  if (callerMember.role !== "owner") {
    return err(ERR.forbidden, "Only the workspace owner can remove members.");
  }

  // Resolve target.
  let targetUserId: string | null = null;
  if (user_id) {
    targetUserId = user_id;
  } else if (username) {
    const stripped = username.replace(/^@/, "").toLowerCase();
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.telegramUsername}) = ${stripped}`)
      .limit(1);
    if (!u) {
      return err(ERR.not_found, `No user found with username @${stripped}.`);
    }
    targetUserId = u.id;
  }
  if (!targetUserId) {
    return err(ERR.invalid_input, "Either username or user_id is required.");
  }

  // Cannot remove self / owner.
  if (targetUserId === ctx.userId) {
    return err(
      "cannot_remove_self",
      "You can't remove yourself; transfer ownership or delete the workspace.",
    );
  }

  const targetMember = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, ctx.workspaceId),
      eq(workspaceMembers.userId, targetUserId),
    ),
  });
  if (!targetMember) {
    return err(ERR.not_found, "That user isn't a member of this workspace.");
  }
  if (targetMember.role === "owner") {
    return err(
      "cannot_remove_owner",
      "Cannot remove the workspace owner. Transfer ownership first.",
    );
  }

  // Workspace info for activity_log payload.
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .limit(1);
  if (!workspace) {
    return err(ERR.not_found, "Workspace not found.");
  }

  return await db.transaction(async (tx) => {
    // 1. Per-list cascade: find every list in the workspace where the
    //    target had a list_members row.
    const workspaceListIds = (
      await tx
        .select({ id: lists.id })
        .from(lists)
        .where(eq(lists.workspaceId, ctx.workspaceId))
    ).map((r) => r.id);

    if (workspaceListIds.length > 0) {
      // Clear assignee on items assigned to the removed user.
      await tx
        .update(items)
        .set({ assigneeId: null, updatedAt: new Date() })
        .where(
          and(
            inArray(items.listId, workspaceListIds),
            eq(items.assigneeId, targetUserId),
          ),
        );

      // Delete per-list memberships in the workspace.
      await tx
        .delete(listMembers)
        .where(
          and(
            inArray(listMembers.listId, workspaceListIds),
            eq(listMembers.userId, targetUserId),
          ),
        );
    }

    // 2. Delete the workspace membership.
    await tx
      .delete(workspaceMembers)
      .where(eq(workspaceMembers.id, targetMember.id));

    // 3. Activity log row for the workspace's audit stream.
    await tx.insert(activityLog).values({
      listId: null,
      entityType: "workspace",
      entityId: ctx.workspaceId,
      action: "workspace_member_removed",
      actorId: ctx.userId,
      payloadBefore: {
        workspaceId: ctx.workspaceId,
        userId: targetUserId,
        role: targetMember.role,
      },
      payloadAfter: null,
    });

    return ok({
      workspace_id: ctx.workspaceId,
      removed_user_id: targetUserId,
    });
  });
}
