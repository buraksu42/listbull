/**
 * Executor: `remove_reminder` (Phase 14d).
 *
 * Delete a single reminder by id. Permission scoped to the parent
 * item's list. Does NOT touch the item's deadline.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemReminders, items } from "@/lib/db/schema";
import {
  removeReminderInputSchema,
  type RemoveReminderOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toItemReminderSnapshot } from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

export async function executeRemoveReminder(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<RemoveReminderOutput>> {
  const parsed = removeReminderInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { reminder_id } = parsed.data;

  return await db.transaction(async (tx) => {
    const [reminder] = await tx
      .select()
      .from(itemReminders)
      .where(eq(itemReminders.id, reminder_id))
      .limit(1);
    if (!reminder) {
      return err(ERR.not_found, "Reminder not found.");
    }
    const [parent] = await tx
      .select()
      .from(items)
      .where(eq(items.id, reminder.itemId))
      .limit(1);
    if (!parent || parent.archivedAt) {
      return err(ERR.not_found, "Item not found.");
    }
    const allowed = await userCanWriteList(
      ctx.userId,
      parent.listId,
      ctx.workspaceId,
    );
    if (!allowed) {
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    const snapshot = toItemReminderSnapshot(reminder);
    await tx.delete(itemReminders).where(eq(itemReminders.id, reminder_id));

    await tx.insert(activityLog).values({
      listId: parent.listId,
      entityType: "item",
      entityId: parent.id,
      action: "item_reminder_removed",
      actorId: ctx.userId,
      payloadBefore: snapshot,
      payloadAfter: null,
    });

    return ok({
      reminder_id,
      item_id: parent.id,
    });
  });
}
