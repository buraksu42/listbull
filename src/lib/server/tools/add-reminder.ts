/**
 * Executor: `add_reminder` (Phase 17 chat-only).
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemReminders, items } from "@/lib/db/schema";
import {
  addReminderInputSchema,
  type AddReminderOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toItemReminderSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeAddReminder(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<AddReminderOutput>> {
  const parsed = addReminderInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, remind_at, offset_minutes, recurrence_rule } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, item_id), eq(items.chatId, ctx.chatId)))
      .limit(1);
    if (!current) return err(ERR.not_found, "Item not found.");

    let remindAt: Date;
    let kind: "absolute" | "before_deadline";
    let effectiveOffsetMinutes: number | null = null;
    if (remind_at !== undefined) {
      remindAt = new Date(remind_at);
      kind = "absolute";
    } else if (offset_minutes !== undefined) {
      if (current.deadlineAt) {
        // Anchored to deadline → before_deadline kind. Reminder recomputes
        // automatically when the deadline shifts (recomputeOffsetReminders).
        remindAt = new Date(
          current.deadlineAt.getTime() - offset_minutes * 60_000,
        );
        kind = "before_deadline";
        effectiveOffsetMinutes = offset_minutes;
      } else {
        // No deadline → interpret as "N minutes from now". Falls into the
        // absolute kind so the cron picks it up just like a remind_at.
        // Phase 17: user wanted offset_minutes to work without a forced
        // set_deadline first.
        remindAt = new Date(Date.now() + offset_minutes * 60_000);
        kind = "absolute";
      }
    } else {
      return err(ERR.invalid_input, "remind_at or offset_minutes required.");
    }

    const [created] = await tx
      .insert(itemReminders)
      .values({
        itemId: item_id,
        kind,
        remindAt,
        offsetMinutes: effectiveOffsetMinutes,
        recurrenceRule: recurrence_rule ?? null,
      })
      .returning();
    if (!created) throw new Error("add-reminder: insert returned no row");

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: item_id,
      action: "item_reminder_added",
      actorId: ctx.userId,
      payloadBefore: null,
      payloadAfter: toItemReminderSnapshot(created),
    });

    return ok({ reminder: toItemReminderSnapshot(created) });
  });
}
