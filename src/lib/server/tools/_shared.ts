/**
 * Shared internals for tool executors (Phase 17 chat-only).
 *
 * Workspace + list resolution removed; items live directly under
 * a chat_id. Helpers here are now purely about envelope types,
 * reminder-recompute on deadline change, and ILIKE escape.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { itemReminders } from "@/lib/db/schema";
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
