/**
 * Executor: `create_item` (Phase 17 chat-only).
 *
 * Inserts one row into `items` with chat_id = ExecutorCtx.chatId. When
 * deadline_at is supplied, auto-creates a single absolute reminder
 * anchored at the same moment. Activity log row written in the same
 * transaction (Inv-1).
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemReminders, items } from "@/lib/db/schema";
import {
  createItemInputSchema,
  type CreateItemOutput,
} from "@/lib/ai/tools";
import { ERR, err, isPast, ok, toItemReminderSnapshot, toItemSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeCreateItem(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<CreateItemOutput>> {
  const parsed = createItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const {
    text,
    description,
    deadline_at,
    is_checkable,
    kind,
    parent_item_id,
  } = parsed.data;

  const warnings: string[] = [];
  let deadlineDate: Date | null = null;
  if (deadline_at) {
    deadlineDate = new Date(deadline_at);
    if (isPast(deadline_at)) {
      warnings.push("deadline_at_in_past");
    }
  }

  return await db.transaction(async (tx) => {
    // Validate parent FK eagerly so the CHECK constraint on the DB
    // doesn't surface as a generic 23514 error.
    if (parent_item_id) {
      const [parent] = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(eq(items.id, parent_item_id), eq(items.chatId, ctx.chatId)),
        )
        .limit(1);
      if (!parent) {
        return err(
          ERR.not_found,
          `parent_item_id ${parent_item_id} not found in this chat.`,
        );
      }
    }

    const [created] = await tx
      .insert(items)
      .values({
        chatId: ctx.chatId,
        text: text.trim(),
        description: description?.trim() || null,
        isCheckable: is_checkable,
        deadlineAt: deadlineDate,
        createdBy: ctx.userId,
        kind,
        parentItemId: parent_item_id ?? null,
      })
      .returning();
    if (!created) throw new Error("create-item: insert returned no row");

    const reminderRows: (typeof itemReminders.$inferSelect)[] = [];
    if (deadlineDate) {
      const [reminder] = await tx
        .insert(itemReminders)
        .values({
          itemId: created.id,
          kind: "absolute",
          remindAt: deadlineDate,
        })
        .returning();
      if (reminder) reminderRows.push(reminder);
    }

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: created.id,
      action: "item_created",
      actorId: ctx.userId,
      payloadBefore: null,
      payloadAfter: toItemSnapshot(created),
    });

    return ok({
      item: toItemSnapshot(created),
      reminders: reminderRows.map(toItemReminderSnapshot),
      ...(warnings.length ? { warnings } : {}),
    });
  });
}
