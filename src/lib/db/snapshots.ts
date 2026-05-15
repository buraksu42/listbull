/**
 * Layer-neutral row-to-snapshot serializers (Phase 17 chat-only).
 *
 * `activity_log.payload_before` / `payload_after` are JSONB columns that
 * store JSON-safe shapes of items, reminders, and attachments. Used by:
 *   - `src/lib/server/tools/**` executors (Inv-1 transactional writes).
 *   - `src/lib/db/queries/**` (e.g. cron reminder dispatcher logging).
 *
 * Layering rule (project-wide):
 *   - `db/queries/**` and `db/snapshots.ts` MUST NOT import from
 *     `server/**`, `app/**`, or any UI layer. They are leaves.
 *   - Imports allowed: `db/schema.ts`, `db/client.ts`, `lib/types`, and
 *     `drizzle-orm`.
 */
import type {
  AttachmentKind,
  AttachmentSnapshot,
  Item,
  ItemAttachment,
  ItemReminder,
  ItemReminderKind,
  ItemReminderSnapshot,
  ItemSnapshot,
} from "@/lib/types";

/**
 * Convert an `Item` row into the JSON-safe `ItemSnapshot` shape that
 * `activity_log.payload_*` columns store. Per Inv-5, every Date becomes
 * an ISO 8601 string for round-trip stability.
 */
export function toItemSnapshot(row: Item): ItemSnapshot {
  return {
    id: row.id,
    chatId: row.chatId,
    text: row.text,
    description: row.description ?? null,
    isCheckable: row.isCheckable,
    isDone: row.isDone,
    status: row.status,
    priority: row.priority,
    tags: row.tags ?? [],
    assigneeId: row.assigneeId,
    deadlineAt: row.deadlineAt ? row.deadlineAt.toISOString() : null,
    pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
    taskRecurrenceRule: row.taskRecurrenceRule ?? null,
    position: row.position,
    createdBy: row.createdBy,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Convert an `ItemAttachment` row into a JSON-safe `AttachmentSnapshot`.
 * Hides the raw `telegramFileId` from the client-facing shape.
 */
export function toAttachmentSnapshot(row: ItemAttachment): AttachmentSnapshot {
  return {
    id: row.id,
    itemId: row.itemId,
    chatId: row.chatId,
    kind: row.kind as AttachmentKind,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
    originalFilename: row.originalFilename,
    uploadedByUserId: row.uploadedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Convert an `ItemReminder` row into a JSON-safe snapshot. */
export function toItemReminderSnapshot(row: ItemReminder): ItemReminderSnapshot {
  return {
    id: row.id,
    itemId: row.itemId,
    remindAt: row.remindAt.toISOString(),
    kind: row.kind as ItemReminderKind,
    offsetMinutes: row.offsetMinutes,
    recurrenceRule: row.recurrenceRule,
    sent: row.sent,
    lastSentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
  };
}
