/**
 * Executor: `remove_reminder` (Phase 17 chat-only).
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemReminders, items } from "@/lib/db/schema";
import {
  removeReminderInputSchema,
  type RemoveReminderOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toItemReminderSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeRemoveReminder(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<RemoveReminderOutput>> {
  const parsed = removeReminderInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { reminder_id } = parsed.data;

  return await db.transaction(async (tx) => {
    // Join to items to enforce chat scope.
    const [row] = await tx
      .select({
        reminder: itemReminders,
        itemChatId: items.chatId,
      })
      .from(itemReminders)
      .innerJoin(items, eq(items.id, itemReminders.itemId))
      .where(eq(itemReminders.id, reminder_id))
      .limit(1);
    if (!row || row.itemChatId !== ctx.chatId) {
      return err(ERR.not_found, "Reminder not found.");
    }

    await tx
      .delete(itemReminders)
      .where(eq(itemReminders.id, reminder_id));

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: row.reminder.itemId,
      action: "item_reminder_removed",
      actorId: ctx.userId,
      payloadBefore: toItemReminderSnapshot(row.reminder),
      payloadAfter: null,
    });

    // and import — silence unused warning when only chatId guard hits.
    void and;
    return ok({ removed: true });
  });
}
