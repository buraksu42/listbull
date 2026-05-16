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
 * Drizzle's postgres-js driver normally returns timestamptz values
 * as Date objects, but in some build/runtime combos (notably the
 * Next.js standalone server we ship to Dokploy) we've observed
 * strings sneaking through. This helper accepts either and always
 * returns a canonical ISO 8601 string — keeps the snapshot
 * serializers crash-free.
 */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  // Cast: postgres returns "2026-05-15 13:29:23.726+00" or ISO.
  // new Date(...) accepts both forms.
  return new Date(value).toISOString();
}

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
    deadlineAt: toIso(row.deadlineAt),
    pinnedAt: toIso(row.pinnedAt),
    taskRecurrenceRule: row.taskRecurrenceRule ?? null,
    position: row.position,
    createdBy: row.createdBy,
    completedAt: toIso(row.completedAt),
    archivedAt: toIso(row.archivedAt),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    kind: (row.kind ?? "todo") as ItemSnapshot["kind"],
    parentItemId: row.parentItemId ?? null,
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
    createdAt: toIso(row.createdAt)!,
  };
}

/** Convert an `ItemReminder` row into a JSON-safe snapshot. */
export function toItemReminderSnapshot(row: ItemReminder): ItemReminderSnapshot {
  return {
    id: row.id,
    itemId: row.itemId,
    remindAt: toIso(row.remindAt)!,
    kind: row.kind as ItemReminderKind,
    offsetMinutes: row.offsetMinutes,
    recurrenceRule: row.recurrenceRule,
    sent: row.sent,
    lastSentAt: toIso(row.sentAt),
    createdAt: toIso(row.createdAt)!,
    // item_reminders no longer has updated_at (migration 0030). Mirror
    // createdAt here so the snapshot shape stays stable.
    updatedAt: toIso(row.createdAt)!,
  };
}
