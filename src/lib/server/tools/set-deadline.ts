/**
 * Executor: `set_deadline` (Phase 14d).
 *
 * Sets or clears the deadline on an existing item. Distinct from
 * reminders — see `add_reminder` / `remove_reminder` for those.
 *
 * Behavior:
 *   - Notes (`is_checkable=false`) cannot have a deadline →
 *     `cannot_schedule_note`.
 *   - Past `deadline_at` is silently dropped + warning surfaced; the
 *     executor returns `ok` with the unchanged snapshot.
 *   - When the deadline changes, every `before_deadline` reminder for
 *     the item is recomputed in lock-step (same transaction).
 *   - Clearing the deadline (`deadline_at: null`) drops every
 *     `before_deadline` reminder; absolute reminders survive.
 */
import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemReminders, items } from "@/lib/db/schema";
import {
  setDeadlineInputSchema,
  type SetDeadlineOutput,
} from "@/lib/ai/tools";
import {
  ERR,
  err,
  isPast,
  ok,
  recomputeOffsetReminders,
  toItemReminderSnapshot,
  toItemSnapshot,
} from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

export async function executeSetDeadline(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<SetDeadlineOutput>> {
  const parsed = setDeadlineInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, deadline_at } = parsed.data;

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
      return err("cannot_schedule_note", "Notes cannot have deadlines.");
    }

    const allowed = await userCanWriteList(
      ctx.userId,
      current.listId,
      ctx.workspaceId,
    );
    if (!allowed) {
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    const warnings: string[] = [];
    let cleared = false;

    let nextDeadline: Date | null;
    if (deadline_at === null) {
      nextDeadline = null;
      cleared = current.deadlineAt !== null;
    } else {
      if (isPast(deadline_at)) {
        warnings.push("deadline_at_in_past");
        const reminders = await tx
          .select()
          .from(itemReminders)
          .where(eq(itemReminders.itemId, item_id))
          .orderBy(asc(itemReminders.remindAt));
        return ok({
          item: toItemSnapshot(current),
          reminders: reminders.map(toItemReminderSnapshot),
          cleared: false,
          warnings,
        });
      }
      nextDeadline = new Date(deadline_at);
    }

    const oldIso = current.deadlineAt?.toISOString() ?? null;
    const newIso = nextDeadline?.toISOString() ?? null;
    if (oldIso === newIso) {
      const reminders = await tx
        .select()
        .from(itemReminders)
        .where(eq(itemReminders.itemId, item_id))
        .orderBy(asc(itemReminders.remindAt));
      return ok({
        item: toItemSnapshot(current),
        reminders: reminders.map(toItemReminderSnapshot),
        cleared: false,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    const [updated] = await tx
      .update(items)
      .set({ deadlineAt: nextDeadline, updatedAt: new Date() })
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) {
      throw new Error("set-deadline: update returned no row");
    }

    // Recompute every before_deadline reminder for this item.
    await recomputeOffsetReminders(tx, item_id, nextDeadline);

    const remindersAfter = await tx
      .select()
      .from(itemReminders)
      .where(eq(itemReminders.itemId, item_id))
      .orderBy(asc(itemReminders.remindAt));

    const action =
      nextDeadline === null ? "item_deadline_cleared" : "item_deadline_set";
    await tx.insert(activityLog).values({
      listId: updated.listId,
      entityType: "item",
      entityId: updated.id,
      action,
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    return ok({
      item: toItemSnapshot(updated),
      reminders: remindersAfter.map(toItemReminderSnapshot),
      cleared,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}
