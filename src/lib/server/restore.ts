/**
 * F2 — item restore from activity_log.payload_before (Phase 4).
 *
 * Inv-21 (server-side enforcement, defense-in-depth):
 *   1. Look up the activity_log row by id.
 *   2. Reject unless `action === 'item_deleted'`.
 *   3. Reject unless `(now() - created_at) <= 30 days`
 *      (`restore_window_expired`).
 *   4. Verify the caller is the list's owner.
 *
 * Inside one transaction (Inv-1):
 *   - Read `payload_before` as `ItemSnapshot` (zod-validate at the
 *     boundary; reject `restore_payload_invalid` if malformed).
 *   - INSERT a NEW `items` row from the snapshot (new uuid;
 *     archived_at=null; reminder_sent recomputed from due_at).
 *   - INSERT a new activity_log row with `action='item_created'` and
 *     `payload_after = ItemSnapshot` of the new row. Phase 4 deliberately
 *     does NOT introduce an `item_restored` action — chronology +
 *     payload_before equality identifies restored items if needed.
 *
 * Note: position is preserved from the snapshot. If a sibling item
 * has since taken that position, both will share the value — the UI
 * sorts on (isDone, position, createdAt), so the freshly-inserted row
 * comes last among ties due to its newer createdAt.
 */
import "server-only";

import { z } from "zod";

import { db } from "@/lib/db/client";
import { activityLog, items, lists } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

import { getActivityLogRow } from "@/lib/db/queries/audit";
import { isListOwner } from "@/lib/db/queries/members";
import { toItemSnapshot } from "@/lib/db/snapshots";
import type { ItemSnapshot } from "@/lib/types";

/** Inv-21 window — 30 days in ms. */
const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Zod schema mirroring `ItemSnapshot`. Used to validate raw JSONB so
 * a malformed payload returns a structured error rather than crashing.
 */
const itemSnapshotSchema = z.object({
  id: z.string(),
  listId: z.string(),
  text: z.string(),
  isCheckable: z.boolean(),
  isDone: z.boolean(),
  assigneeId: z.string().nullable(),
  dueAt: z.string().nullable(),
  reminderSent: z.boolean(),
  position: z.number(),
  createdBy: z.string(),
  completedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RestoreResult =
  | { ok: true; item: ItemSnapshot }
  | { ok: false; code: string; message: string };

export async function restoreFromActivityLog(args: {
  listId: string;
  activityLogId: string;
  callerId: string;
}): Promise<RestoreResult> {
  const { listId, activityLogId, callerId } = args;

  // ─── Pre-transaction guards (read-only) ──────────────────────────
  const logRow = await getActivityLogRow(activityLogId);
  if (!logRow) {
    return {
      ok: false,
      code: "not_found",
      message: "Audit entry not found.",
    };
  }
  if (logRow.listId !== listId) {
    // Don't leak existence of activity_log rows across lists.
    return {
      ok: false,
      code: "not_found",
      message: "Audit entry not found.",
    };
  }
  if (logRow.action !== "item_deleted") {
    return {
      ok: false,
      code: "not_restorable",
      message: "Only deletion entries can be restored.",
    };
  }
  if (Date.now() - logRow.createdAt.getTime() > RESTORE_WINDOW_MS) {
    return {
      ok: false,
      code: "restore_window_expired",
      message: "This deletion is older than the 30-day restore window.",
    };
  }

  // Owner-only.
  const isOwner = await isListOwner(listId, callerId);
  if (!isOwner) {
    return {
      ok: false,
      code: "forbidden",
      message: "Only the list owner can restore.",
    };
  }

  const parsedSnapshot = itemSnapshotSchema.safeParse(logRow.payloadBefore);
  if (!parsedSnapshot.success) {
    return {
      ok: false,
      code: "restore_payload_invalid",
      message: "Audit payload is malformed; cannot restore.",
    };
  }
  const snap = parsedSnapshot.data;

  // ─── Transactional insert (Inv-1) ────────────────────────────────
  return await db.transaction(async (tx) => {
    // List must still exist + not be archived.
    const [listRow] = await tx
      .select({ id: lists.id, archivedAt: lists.archivedAt })
      .from(lists)
      .where(eq(lists.id, listId))
      .limit(1);
    if (!listRow || listRow.archivedAt) {
      return {
        ok: false,
        code: "not_found",
        message: "List is no longer available.",
      };
    }

    const dueAt = snap.dueAt ? new Date(snap.dueAt) : null;
    const reminderSent = dueAt ? dueAt.getTime() <= Date.now() : false;

    const [created] = await tx
      .insert(items)
      .values({
        listId: snap.listId,
        text: snap.text,
        isCheckable: snap.isCheckable,
        isDone: false,
        assigneeId: null, // assignee membership may have changed; reset.
        dueAt,
        reminderSent,
        position: snap.position,
        createdBy: snap.createdBy,
        completedAt: null,
        archivedAt: null,
      })
      .returning();
    if (!created) throw new Error("restore: insert returned no row");

    const newSnapshot = toItemSnapshot(created);

    await tx.insert(activityLog).values({
      listId,
      entityType: "item",
      entityId: created.id,
      action: "item_created",
      actorId: callerId,
      payloadBefore: null,
      payloadAfter: newSnapshot,
    });

    return { ok: true, item: newSnapshot };
  });
}
