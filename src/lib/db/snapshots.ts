/**
 * Layer-neutral row-to-snapshot serializers (Phase 4 · P2-7).
 *
 * `activity_log.payload_before` / `payload_after` are JSONB columns that
 * store JSON-safe shapes of items, lists, and members. Two consumers
 * need these serializers:
 *   - `src/lib/server/tools/**` executors (Inv-1 transactional writes).
 *   - `src/lib/db/queries/**` (e.g. `members.ts` removeMember writes
 *     `item_unassigned` rows; `invites.ts` writes `member_added`).
 *
 * Pre-Phase-4, `toItemSnapshot` lived in `server/tools/_shared.ts`, which
 * forced `db/queries/members.ts` to import upward into `server/**`. That
 * inverts the layering — `db/**` should be the leaf layer.
 *
 * Phase 4 hoists the helpers here. `_shared.ts` re-exports `toItemSnapshot`
 * for back-compat so existing executor imports keep working.
 *
 * Layering rule (project-wide):
 *   - `db/queries/**` and `db/snapshots.ts` MUST NOT import from
 *     `server/**`, `app/**`, or any UI layer. They are leaves.
 *   - Imports allowed: `db/schema.ts`, `db/client.ts`, `lib/types`, and
 *     `drizzle-orm`.
 */
import type {
  Item,
  List as ListRow,
  ListMember as ListMemberRow,
  ListRole,
  MemberSnapshot,
} from "@/lib/types";

/**
 * Convert an `Item` row into the JSON-safe `ItemSnapshot` shape that
 * `activity_log.payload_*` columns store. Per Inv-5, every Date becomes
 * an ISO 8601 string for round-trip stability.
 */
export function toItemSnapshot(row: Item) {
  return {
    id: row.id,
    listId: row.listId,
    text: row.text,
    isCheckable: row.isCheckable,
    isDone: row.isDone,
    assigneeId: row.assigneeId,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    reminderSent: row.reminderSent,
    position: row.position,
    createdBy: row.createdBy,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Convert a `lists` row into the JSON-safe `ListSnapshot` shape (used by
 * F2 restore and any future list-level audit rows). Mirrors `ItemSnapshot`
 * conventions — Date → ISO string.
 */
export function toListSnapshot(row: ListRow) {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    ownerId: row.ownerId,
    isInbox: row.isInbox,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Build a `MemberSnapshot` from a member row + its joined user info.
 * Used by `acceptInvite` (`member_added`) and `removeMember` /
 * `updateMemberRole` (`member_removed` / `member_role_changed`).
 */
export function toMemberSnapshot(
  member: ListMemberRow,
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
    telegramPhotoUrl: string | null;
  },
): MemberSnapshot {
  return {
    id: member.id,
    listId: member.listId,
    userId: member.userId,
    role: member.role as ListRole,
    invitedBy: member.invitedBy,
    acceptedAt: member.acceptedAt.toISOString(),
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    user: {
      telegramFirstName: user.telegramFirstName,
      telegramUsername: user.telegramUsername,
      telegramPhotoUrl: user.telegramPhotoUrl,
    },
  };
}

