/**
 * Executor: `update_member_role` — wraps the existing
 * `updateMemberRole` query helper. Owner-only; cannot demote owner.
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { listMembers, users } from "@/lib/db/schema";
import {
  updateMemberRoleInputSchema,
  type UpdateMemberRoleOutput,
} from "@/lib/ai/tools";
import { updateMemberRole } from "@/lib/db/queries/members";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeUpdateMemberRole(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<UpdateMemberRoleOutput>> {
  const parsed = updateMemberRoleInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { list_id, username, user_id, role } = parsed.data;

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

  const member = await db.query.listMembers.findFirst({
    where: and(
      eq(listMembers.listId, list_id),
      eq(listMembers.userId, targetUserId),
    ),
  });
  if (!member) {
    return err(ERR.not_found, "That user is not a member of this list.");
  }

  const result = await updateMemberRole(list_id, member.id, role, ctx.userId);
  if (!result.ok) {
    return err(result.code, result.message);
  }

  return ok({
    list_id,
    user_id: targetUserId,
    role: result.member.role,
  });
}
