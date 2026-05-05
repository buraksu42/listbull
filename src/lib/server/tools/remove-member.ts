/**
 * Executor: `remove_member` — wraps the existing `removeMember` query
 * helper so the bot LLM can kick a member off a shared list.
 *
 * Resolves the target by `username` (lowered) OR `user_id`, finds the
 * caller's owner-membership and the target's listMembers row, then
 * delegates to the query helper which transactionally:
 *   - DELETEs the list_members row
 *   - clears assignee_id on items assigned to the removed user (Inv-12)
 *   - writes one `member_removed` + N `item_unassigned` activity rows
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { listMembers, lists, users } from "@/lib/db/schema";
import {
  removeMemberInputSchema,
  type RemoveMemberOutput,
} from "@/lib/ai/tools";
import { removeMember } from "@/lib/db/queries/members";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeRemoveMember(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<RemoveMemberOutput>> {
  const parsed = removeMemberInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { list_id, username, user_id } = parsed.data;

  // Workspace gate: caller can only remove members from lists in
  // their active workspace. Cross-workspace mutations rejected even
  // if the caller has list_members access elsewhere.
  const [listRow] = await db
    .select({ workspaceId: lists.workspaceId })
    .from(lists)
    .where(eq(lists.id, list_id))
    .limit(1);
  if (!listRow || listRow.workspaceId !== ctx.workspaceId) {
    return err(ERR.not_found, "List not found in this workspace.");
  }

  // Resolve target userId.
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

  // Resolve list_member row id (the helper takes list_members.id, not user_id).
  const member = await db.query.listMembers.findFirst({
    where: and(
      eq(listMembers.listId, list_id),
      eq(listMembers.userId, targetUserId),
    ),
  });
  if (!member) {
    return err(ERR.not_found, "That user is not a member of this list.");
  }

  const result = await removeMember(list_id, member.id, ctx.userId);
  if (!result.ok) {
    return err(result.code, result.message);
  }

  return ok({
    list_id,
    removed_user_id: targetUserId,
  });
}
