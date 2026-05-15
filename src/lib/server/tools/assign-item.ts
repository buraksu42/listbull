/**
 * Executor: `assign_item` (Phase 17 chat-only).
 *
 * Username resolution via chat_members. Pass null username to clear.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { findChatMemberByUsername } from "@/lib/db/queries/chats";
import { activityLog, items } from "@/lib/db/schema";
import {
  assignItemInputSchema,
  type AssignItemOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toItemSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeAssignItem(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<AssignItemOutput>> {
  const parsed = assignItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, assignee_username } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, item_id), eq(items.chatId, ctx.chatId)))
      .limit(1);
    if (!current) return err(ERR.not_found, "Item not found.");

    let assigneeId: string | null = null;
    let assigneeSnapshot: AssignItemOutput["assignee"] = null;

    if (assignee_username !== null) {
      const member = await findChatMemberByUsername(
        ctx.chatId,
        assignee_username,
      );
      if (!member) {
        return err(
          ERR.not_found,
          `User @${assignee_username.replace(/^@/, "")} is not in this chat.`,
        );
      }
      assigneeId = member.userId;
      assigneeSnapshot = {
        user_id: member.userId,
        telegram_username: member.telegramUsername,
        telegram_first_name: member.telegramFirstName,
      };
    }

    const [updated] = await tx
      .update(items)
      .set({ assigneeId, updatedAt: new Date() })
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) throw new Error("assign-item: update returned no row");

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: updated.id,
      action: assigneeId ? "item_assigned" : "item_unassigned",
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    return ok({
      item: toItemSnapshot(updated),
      assignee: assigneeSnapshot,
    });
  });
}
