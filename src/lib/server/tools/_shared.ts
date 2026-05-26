/**
 * Shared internals for tool executors (Phase 17 chat-only).
 *
 * Workspace + list resolution removed; items live directly under
 * a chat_id. Helpers here are now purely about envelope types,
 * reminder-recompute on deadline change, and ILIKE escape.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  itemAttachments,
  itemReminders,
  items,
} from "@/lib/db/schema";
import {
  toAttachmentSnapshot,
  toItemReminderSnapshot,
  toItemSnapshot,
} from "@/lib/db/snapshots";
import type { Item } from "@/lib/types";

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
/**
 * Result of an auto-rollup attempt. `flipped: true` means the parent's
 * done state changed in this call; `parentId` + `parentNowDone` are
 * populated when there was a parent to consider (regardless of flip).
 * Callers use this to show feedback (e.g. a "✅ Checklist tamamlandı"
 * callback-answer toast) without re-querying.
 */
export type RollupResult = {
  parentId: string | null;
  parentNowDone: boolean | null;
  flipped: boolean;
};

export async function rollupParentDoneState(
  tx: Tx,
  childItemId: string,
  chatId: number,
  actorId: string,
): Promise<RollupResult> {
  const [child] = await tx
    .select({
      parentItemId: items.parentItemId,
    })
    .from(items)
    .where(and(eq(items.id, childItemId), eq(items.chatId, chatId)))
    .limit(1);
  if (!child || !child.parentItemId) {
    console.log("[rollup:skip]", { childItemId, reason: !child ? "child_missing" : "no_parent" });
    return { parentId: null, parentNowDone: null, flipped: false };
  }

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
  if (!parent) {
    console.log("[rollup:skip]", { childItemId, parentId: child.parentItemId, reason: "parent_missing_or_archived" });
    return { parentId: child.parentItemId, parentNowDone: null, flipped: false };
  }
  if (parent.kind !== "todo") {
    console.log("[rollup:skip]", { parentId: parent.id, reason: "parent_kind", kind: parent.kind });
    return { parentId: parent.id, parentNowDone: parent.isDone, flipped: false };
  }
  if (parent.taskRecurrenceRule) {
    console.log("[rollup:skip]", { parentId: parent.id, reason: "rrule_parent" });
    return { parentId: parent.id, parentNowDone: parent.isDone, flipped: false };
  }

  const siblings = await tx
    .select({ isDone: items.isDone })
    .from(items)
    .where(
      and(
        eq(items.parentItemId, child.parentItemId),
        isNull(items.archivedAt),
      ),
    );
  if (siblings.length === 0) {
    console.log("[rollup:skip]", { parentId: parent.id, reason: "no_siblings" });
    return { parentId: parent.id, parentNowDone: parent.isDone, flipped: false };
  }

  const doneCount = siblings.filter((s) => s.isDone === true).length;
  const desired = doneCount === siblings.length;
  console.log("[rollup:eval]", {
    parentId: parent.id,
    parentIsDone: parent.isDone,
    siblings: siblings.length,
    siblingsDone: doneCount,
    desired,
    willFlip: parent.isDone !== desired,
  });
  if (parent.isDone === desired) {
    return { parentId: parent.id, parentNowDone: parent.isDone, flipped: false };
  }

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
  if (!updated) {
    console.log("[rollup:skip]", { parentId: parent.id, reason: "update_returned_no_row" });
    return { parentId: parent.id, parentNowDone: parent.isDone, flipped: false };
  }

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
  console.log("[rollup:flipped]", {
    parentId: parent.id,
    nowDone: desired,
  });
  return { parentId: parent.id, parentNowDone: desired, flipped: true };
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

/**
 * Recurrence clone-and-complete (replaces the in-place "advance the
 * same row" behaviour the executor used to do).
 *
 * Called when a task with `task_recurrence_rule` is marked done:
 *  - the ORIGINAL row stays marked done so it lands in /done (audit
 *    trail of "I did the dishes on Monday, Tuesday, Wednesday…").
 *  - a fresh row is INSERTED with the same text / description /
 *    priority / tags / kind / parent / recurrence rule, anchored at
 *    `nextDeadline`. Reminders are cloned (before_deadline recomputed
 *    off the new deadline; absolute reminders cloned with sent=false
 *    so the new cycle gets its own ping). Attachments are cloned by
 *    duplicating the rows — Telegram file_ids are stable for the
 *    bot's lifetime, so referencing the same file_id from a new row
 *    is safe and cheap.
 *  - any pending reminders on the ORIGINAL are deleted (a "done" row
 *    shouldn't keep pinging — the dispatcher gates on archived_at,
 *    not is_done, so leaving them would cause duplicate pings on the
 *    original AND the clone).
 *  - an `item_created` activity row is written for the clone so the
 *    feed / digest surfaces show the new cycle as a fresh event.
 *
 * Returns the inserted row so the caller can surface "🔁 yeni açıldı:
 * <text>" to the user.
 */
export async function cloneRecurringItemAsNextCycle(
  tx: Tx,
  original: Item,
  nextDeadline: Date,
  actorId: string,
): Promise<Item> {
  // Insert the clone first so we have its id for child-row inserts.
  // Position inherits from the original so the clone sits in the same
  // visual slot in /items (the original has moved to /done by now).
  const now = new Date();
  const [clone] = await tx
    .insert(items)
    .values({
      chatId: original.chatId,
      kind: original.kind,
      parentItemId: original.parentItemId,
      text: original.text,
      description: original.description,
      isCheckable: original.isCheckable,
      isDone: false,
      status: "open",
      priority: original.priority,
      tags: original.tags,
      deadlineAt: nextDeadline,
      pinnedAt: original.pinnedAt,
      taskRecurrenceRule: original.taskRecurrenceRule,
      position: original.position,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!clone) throw new Error("cloneRecurringItemAsNextCycle: insert returned no row");

  // Clone reminders. We read whatever's on the original (sent or not)
  // so the new cycle reflects the user's intent ("remind me 30min
  // before deadline" stays attached to each new cycle).
  const reminderRows = await tx
    .select()
    .from(itemReminders)
    .where(eq(itemReminders.itemId, original.id));
  const nextDeadlineMs = nextDeadline.getTime();
  for (const r of reminderRows) {
    let newRemindAt: Date;
    if (r.kind === "before_deadline" && r.offsetMinutes !== null) {
      newRemindAt = new Date(
        nextDeadlineMs - r.offsetMinutes * 60_000,
      );
    } else {
      // Absolute reminders carry their own clock. Re-arm at the
      // original wall time so the next cycle's ping fires again.
      newRemindAt = r.remindAt;
    }
    await tx.insert(itemReminders).values({
      itemId: clone.id,
      kind: r.kind,
      remindAt: newRemindAt,
      offsetMinutes: r.offsetMinutes,
      recurrenceRule: r.recurrenceRule,
      sent: false,
    });
  }

  // Drop any pending reminders on the original — it's done now; the
  // dispatcher would otherwise keep pinging because it gates on
  // archived_at, not is_done.
  await tx
    .delete(itemReminders)
    .where(eq(itemReminders.itemId, original.id));

  // Clone attachments. Telegram file_id is bot-scoped and stable
  // across the bot's lifetime, so the new row references the same
  // upload — no re-upload, no extra storage.
  const attachmentRows = await tx
    .select()
    .from(itemAttachments)
    .where(eq(itemAttachments.itemId, original.id));
  for (const a of attachmentRows) {
    await tx.insert(itemAttachments).values({
      itemId: clone.id,
      chatId: a.chatId,
      kind: a.kind,
      telegramFileId: a.telegramFileId,
      telegramFileUniqueId: a.telegramFileUniqueId,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      durationSeconds: a.durationSeconds,
      width: a.width,
      height: a.height,
      thumbnailFileId: a.thumbnailFileId,
      originalFilename: a.originalFilename,
      uploadedByUserId: a.uploadedByUserId,
    });
  }

  await tx.insert(activityLog).values({
    chatId: original.chatId,
    entityType: "item",
    entityId: clone.id,
    action: "item_created",
    actorId,
    payloadBefore: null,
    payloadAfter: {
      ...toItemSnapshot(clone),
      recurrence_clone_of: original.id,
    },
  });

  return clone;
}
