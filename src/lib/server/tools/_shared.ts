/**
 * Shared internals for tool executors (Phase 17 chat-only).
 *
 * Workspace + list resolution removed; items live directly under
 * a chat_id. Helpers here are now purely about envelope types,
 * reminder-recompute on deadline change, and ILIKE escape.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemReminders, items } from "@/lib/db/schema";
import {
  toAttachmentSnapshot,
  toItemReminderSnapshot,
  toItemSnapshot,
} from "@/lib/db/snapshots";

export { toAttachmentSnapshot, toItemReminderSnapshot, toItemSnapshot };

/**
 * Discriminated union returned by every executor.
 */
export type ExecResult<TOk> =
  | { ok: true; data: TOk }
  | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): ExecResult<T> {
  return { ok: true, data };
}

export function err(code: string, message: string): ExecResult<never> {
  return { ok: false, error: { code, message } };
}

/** Standard error codes reused across executors. */
export const ERR = {
  bad_input: "bad_input",
  invalid_input: "invalid_input",
  forbidden: "forbidden",
  not_found: "not_found",
  internal_error: "internal_error",
  /** Action refused because a parent has open sub-items (checklist gate). */
  gate_blocked: "gate_blocked",
} as const;

/** Whether the given ISO 8601 string is in the past. */
export function isPast(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

/** ILIKE-friendly query escape. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/** Drizzle transaction handle type. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Phase 17c — checklist auto-rollup.
 *
 * After a child item's done state changes (via complete_item OR the
 * /items inline toggle), reconcile the parent's done state so a
 * checklist closes itself the moment its last open sub-item is
 * checked, and re-opens if a child gets unchecked.
 *
 * Rules:
 *   - Only applies when the changed item has parentItemId set AND
 *     parent.kind === 'todo' AND parent is not archived.
 *   - Parent done = (every live child isDone). 0 live children → no-op
 *     (an empty parent stays in whatever state it's in).
 *   - Skips RRULE parents — recurring checklist semantics are TBD.
 *   - Writes an activity_log row with payloadAfter.auto_rollup = true
 *     so the feed makes it obvious the flip wasn't a manual action.
 *   - Always called inside the same tx as the child write so the
 *     parent transition stays atomic with the trigger.
 */
export async function rollupParentDoneState(
  tx: Tx,
  childItemId: string,
  chatId: number,
  actorId: string,
): Promise<void> {
  const [child] = await tx
    .select({
      parentItemId: items.parentItemId,
    })
    .from(items)
    .where(and(eq(items.id, childItemId), eq(items.chatId, chatId)))
    .limit(1);
  if (!child || !child.parentItemId) return;

  const [parent] = await tx
    .select()
    .from(items)
    .where(
      and(
        eq(items.id, child.parentItemId),
        eq(items.chatId, chatId),
        isNull(items.archivedAt),
      ),
    )
    .limit(1);
  if (!parent) return;
  if (parent.kind !== "todo") return;
  if (parent.taskRecurrenceRule) return;

  const siblings = await tx
    .select({ isDone: items.isDone })
    .from(items)
    .where(
      and(
        eq(items.parentItemId, child.parentItemId),
        isNull(items.archivedAt),
      ),
    );
  if (siblings.length === 0) return;

  const desired = siblings.every((s) => s.isDone);
  if (parent.isDone === desired) return;

  const now = new Date();
  const [updated] = await tx
    .update(items)
    .set({
      isDone: desired,
      status: desired ? "done" : "open",
      completedAt: desired ? now : null,
      updatedAt: now,
    })
    .where(eq(items.id, parent.id))
    .returning();
  if (!updated) return;

  await tx.insert(activityLog).values({
    chatId,
    entityType: "item",
    entityId: parent.id,
    action: desired ? "item_completed" : "item_uncompleted",
    actorId,
    payloadBefore: toItemSnapshot(parent),
    payloadAfter: {
      ...toItemSnapshot(updated),
      auto_rollup: true,
    },
  });
}

/**
 * When an item's deadline_at changes, recompute every `before_deadline`
 * reminder for the item:
 *   - newDeadline === null → DELETE every before_deadline reminder
 *     (orphan offsets without an anchor are meaningless). Absolute
 *     reminders survive untouched.
 *   - newDeadline non-null → UPDATE remind_at = deadline - offset.
 *     Reset sent=false so the new ping context fires.
 */
export async function recomputeOffsetReminders(
  tx: Tx,
  itemId: string,
  newDeadline: Date | null,
): Promise<void> {
  if (newDeadline === null) {
    await tx
      .delete(itemReminders)
      .where(
        and(
          eq(itemReminders.itemId, itemId),
          eq(itemReminders.kind, "before_deadline"),
        ),
      );
    return;
  }
  const deadlineIso = newDeadline.toISOString();
  // item_reminders.updated_at was dropped in migration 0030 — the
  // table now tracks creation only.
  await tx.execute(sql`
    UPDATE item_reminders
       SET remind_at = ${deadlineIso}::timestamptz - (offset_minutes * interval '1 minute'),
           sent = false
     WHERE item_id = ${itemId}
       AND kind = 'before_deadline'
  `);
}
