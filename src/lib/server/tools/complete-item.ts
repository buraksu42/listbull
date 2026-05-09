/**
 * Executor: `complete_item`. Sets `is_done` explicitly (not toggle).
 *
 * No activity_log row is written when the requested state matches the
 * current state — the LLM should render that as "already done" rather
 * than a redundant confirmation. Notes (`is_checkable=false`) cannot
 * be completed.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import {
  completeItemInputSchema,
  type CompleteItemOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toItemSnapshot } from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

export async function executeCompleteItem(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<CompleteItemOutput>> {
  const parsed = completeItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, is_done } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(eq(items.id, item_id))
      .limit(1);
    if (!current || current.archivedAt) {
      return err(ERR.not_found, "Item not found.");
    }
    if (!current.isCheckable) {
      return err(ERR.invalid_input, "Notes cannot be completed.");
    }

    const allowed = await userCanWriteList(
      ctx.userId,
      current.listId,
      ctx.workspaceId,
    );
    if (!allowed) {
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    const wasDone = current.isDone;

    // Idempotent re-state: skip activity_log + DB write entirely.
    if (wasDone === is_done) {
      return ok({ item: toItemSnapshot(current), was_done: wasDone });
    }

    const now = new Date();

    // Task-level recurrence branch: when an item with a non-null
    // `task_recurrence_rule` is completed, it auto-resurrects instead
    // of permanently marking done. Deadline (if present) advances to
    // the rule's next occurrence; status flips back to 'open';
    // is_done resets; completed_at clears. Distinct from
    // item_reminders.recurrence_rule which only re-fires reminder
    // pings without resurrecting the task.
    if (is_done && current.taskRecurrenceRule) {
      let nextDeadline: Date | null = null;
      try {
        const { RRule } = await import("rrule");
        const rule = RRule.fromString(`RRULE:${current.taskRecurrenceRule}`);
        const anchor = current.deadlineAt ?? now;
        nextDeadline = rule.after(anchor, false) ?? null;
      } catch (e) {
        console.error("[complete-item] invalid task RRULE — clearing", {
          itemId: current.id,
          rule: current.taskRecurrenceRule,
          error: String(e),
        });
      }

      // Rule-exhausted (UNTIL/COUNT) or invalid → fall through to
      // the normal one-shot complete path so the user sees closure.
      if (nextDeadline !== null) {
        const [updated] = await tx
          .update(items)
          .set({
            isDone: false,
            status: "open",
            completedAt: null,
            deadlineAt: nextDeadline,
            updatedAt: now,
          })
          .where(eq(items.id, item_id))
          .returning();
        if (!updated) {
          throw new Error("complete-item: recurrence update returned no row");
        }

        await tx.insert(activityLog).values({
          listId: updated.listId,
          entityType: "item",
          entityId: updated.id,
          action: "item_completed",
          actorId: ctx.userId,
          payloadBefore: toItemSnapshot(current),
          payloadAfter: toItemSnapshot(updated),
        });

        return ok({
          item: toItemSnapshot(updated),
          was_done: wasDone,
          warnings: ["task_recurred"],
        });
      }
      // Falls through to normal complete (rule exhausted/invalid).
    }

    const [updated] = await tx
      .update(items)
      .set({
        isDone: is_done,
        completedAt: is_done ? now : null,
        updatedAt: now,
      })
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) throw new Error("complete-item: update returned no row");

    await tx.insert(activityLog).values({
      listId: updated.listId,
      entityType: "item",
      entityId: updated.id,
      action: is_done ? "item_completed" : "item_uncompleted",
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    return ok({ item: toItemSnapshot(updated), was_done: wasDone });
  });
}
