/**
 * Executor: `set_deadline` (Phase 17 chat-only).
 *
 * Sets / clears items.deadline_at. Auto-creates a single absolute
 * reminder anchored at the new deadline if none exists. Clearing
 * drops every before_deadline reminder; absolute reminders survive.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemReminders, items } from "@/lib/db/schema";
import {
  setDeadlineInputSchema,
  type SetDeadlineOutput,
} from "@/lib/ai/tools";
import {
  ERR,
  err,
  ok,
  recomputeOffsetReminders,
  toItemReminderSnapshot,
  toItemSnapshot,
} from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeSetDeadline(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<SetDeadlineOutput>> {
  const parsed = setDeadlineInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, deadline_at } = parsed.data;
  const newDeadline = deadline_at === null ? null : new Date(deadline_at);

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, item_id), eq(items.chatId, ctx.chatId)))
      .limit(1);
    if (!current) return err(ERR.not_found, "Item not found.");

    const [updated] = await tx
      .update(items)
      .set({ deadlineAt: newDeadline, updatedAt: new Date() })
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) throw new Error("set-deadline: update returned no row");

    await recomputeOffsetReminders(tx, item_id, newDeadline);

    // Auto-create absolute reminder at the new deadline if none exists.
    if (newDeadline) {
      const existingAbsolute = await tx
        .select({ id: itemReminders.id })
        .from(itemReminders)
        .where(
          and(
            eq(itemReminders.itemId, item_id),
            eq(itemReminders.kind, "absolute"),
          ),
        )
        .limit(1);
      if (existingAbsolute.length === 0) {
        await tx.insert(itemReminders).values({
          itemId: item_id,
          kind: "absolute",
          remindAt: newDeadline,
        });
      }
    }

    const reminderRows = await tx
      .select()
      .from(itemReminders)
      .where(eq(itemReminders.itemId, item_id));

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: updated.id,
      action: newDeadline ? "item_deadline_set" : "item_deadline_cleared",
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    return ok({
      item: toItemSnapshot(updated),
      reminders: reminderRows.map(toItemReminderSnapshot),
    });
  });
}
