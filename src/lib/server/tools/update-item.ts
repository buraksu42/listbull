/**
 * Executor: `update_item` (Phase 17 chat-only).
 *
 * Mutates text / description / deadline_at / position / pinned /
 * task_recurrence_rule. Cross-chat moves no longer exist; the chat
 * is implicit. Reminder recompute on deadline change via
 * recomputeOffsetReminders.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  itemReminders,
  items,
} from "@/lib/db/schema";
import {
  updateItemInputSchema,
  type UpdateItemOutput,
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

export async function executeUpdateItem(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<UpdateItemOutput>> {
  const parsed = updateItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const {
    item_id,
    text,
    description,
    deadline_at,
    position,
    pinned,
    task_recurrence_rule,
  } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, item_id), eq(items.chatId, ctx.chatId)))
      .limit(1);
    if (!current) return err(ERR.not_found, "Item not found.");

    const changes: Array<
      | "text"
      | "description"
      | "deadline_at"
      | "position"
      | "pinned"
      | "task_recurrence_rule"
    > = [];
    const patch: Partial<typeof items.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (text !== undefined && text.trim() !== current.text) {
      patch.text = text.trim();
      changes.push("text");
    }
    if (description !== undefined) {
      const next = description?.trim() || null;
      if (next !== current.description) {
        patch.description = next;
        changes.push("description");
      }
    }
    let newDeadline: Date | null | undefined = undefined;
    if (deadline_at !== undefined) {
      newDeadline = deadline_at === null ? null : new Date(deadline_at);
      if (
        (newDeadline?.getTime() ?? null) !==
        (current.deadlineAt?.getTime() ?? null)
      ) {
        patch.deadlineAt = newDeadline;
        changes.push("deadline_at");
      }
    }
    if (position !== undefined && position !== current.position) {
      patch.position = position;
      changes.push("position");
    }
    if (pinned !== undefined) {
      const next = pinned ? new Date() : null;
      const wasPinned = current.pinnedAt !== null;
      if (pinned !== wasPinned) {
        patch.pinnedAt = next;
        changes.push("pinned");
      }
    }
    if (task_recurrence_rule !== undefined) {
      if (task_recurrence_rule !== current.taskRecurrenceRule) {
        patch.taskRecurrenceRule = task_recurrence_rule;
        changes.push("task_recurrence_rule");
      }
    }

    if (changes.length === 0) {
      return ok({
        item: toItemSnapshot(current),
        changes: [],
      });
    }

    const [updated] = await tx
      .update(items)
      .set(patch)
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) throw new Error("update-item: update returned no row");

    let reminderRows: (typeof itemReminders.$inferSelect)[] | undefined;
    if (changes.includes("deadline_at") && newDeadline !== undefined) {
      await recomputeOffsetReminders(tx, item_id, newDeadline);
      reminderRows = await tx
        .select()
        .from(itemReminders)
        .where(eq(itemReminders.itemId, item_id));
    }

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: updated.id,
      action: "item_edited",
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    return ok({
      item: toItemSnapshot(updated),
      changes,
      ...(reminderRows ? { reminders: reminderRows.map(toItemReminderSnapshot) } : {}),
    });
  });
}
