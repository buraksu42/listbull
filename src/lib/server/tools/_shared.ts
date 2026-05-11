/**
 * Shared internals for tool executors. Cross-cutting invariants live
 * here so each executor stays focused on its tool's specific logic.
 *
 * - `ItemSnapshot` factory (Inv-5): JSON-safe shape for activity_log.
 * - List resolution (Inv-3): list_id → exact name → fuzzy → Inbox.
 * - Membership rejection envelopes (Inv-2).
 * - Error envelope helpers (Inv-4).
 */
import { and, eq, ilike, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { itemReminders, listMembers, lists } from "@/lib/db/schema";
import {
  toAttachmentSnapshot,
  toItemReminderSnapshot,
  toItemSnapshot,
  toListRunSnapshot,
} from "@/lib/db/snapshots";
import type { ListRole } from "@/lib/types";

/**
 * `toItemSnapshot` + `toItemReminderSnapshot` are re-exported from the
 * layer-neutral `db/snapshots.ts` (Phase 4 · P2-7). Existing executor
 * imports (`from "./_shared"`) keep working unchanged; the canonical
 * home is now `@/lib/db/snapshots`.
 */
export {
  toAttachmentSnapshot,
  toItemReminderSnapshot,
  toItemSnapshot,
  toListRunSnapshot,
};

/**
 * Discriminated union returned by every executor. Mirrors the tool's
 * output schema in the success branch; all failures share the envelope.
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
  ambiguous_list: "ambiguous_list",
  internal_error: "internal_error",
} as const;

/** Roles allowed to mutate items in a list. */
export const WRITE_ROLES: ListRole[] = ["owner", "editor"];

/**
 * Result of `resolveList` — caller branches on the variant.
 */
export type ListResolution =
  | { kind: "ok"; listId: string; listName: string; emoji: string | null }
  | {
      kind: "ambiguous";
      candidates: Array<{ id: string; name: string }>;
    }
  | { kind: "forbidden" }
  | { kind: "not_found" };

type ResolveOpts = {
  /**
   * If true, fall back to the user's Inbox when nothing matched. Used
   * by `create_item` (per Inv-3 step 3). `update_item` etc. set this
   * to false — they require an explicit item_id.
   */
  inboxFallback?: boolean;
};

/**
 * Per Inv-3: resolve a list reference to a single list_id, scoped to
 * the caller's ACTIVE WORKSPACE (Phase 4.5).
 *
 * 1. If `listId` is provided AND the user has write access AND the
 *    list belongs to the active workspace → ok.
 * 2. Else `listName` exact case-insensitive match within the
 *    workspace → ok.
 * 3. Else `listName` single fuzzy match (ILIKE %name%) → ok.
 * 4. Else multi-fuzzy → ambiguous (caller surfaces error).
 * 5. Else if `inboxFallback` → workspace's inbox.
 * 6. Else → not_found.
 *
 * Filters applied throughout: `list_members.user_id = ctx.userId`
 * (per-list membership) AND `lists.workspace_id = ctx.workspaceId`
 * (workspace scope). A list_id in another workspace returns
 * `forbidden` (don't leak existence across workspaces).
 */
export async function resolveList(
  ctx: { userId: string; workspaceId: string },
  ref: { listId?: string; listName?: string },
  opts: ResolveOpts = {},
): Promise<ListResolution> {
  const { userId, workspaceId } = ctx;

  // 1. explicit id wins.
  if (ref.listId) {
    const explicit = await db
      .select({
        id: lists.id,
        name: lists.name,
        emoji: lists.emoji,
        role: listMembers.role,
        archivedAt: lists.archivedAt,
        workspaceId: lists.workspaceId,
      })
      .from(lists)
      .innerJoin(listMembers, eq(listMembers.listId, lists.id))
      .where(and(eq(lists.id, ref.listId), eq(listMembers.userId, userId)))
      .limit(1);

    const row = explicit[0];
    if (!row) {
      // List exists but user lacks membership, OR list doesn't exist —
      // we don't distinguish (don't leak existence to non-members).
      return { kind: "forbidden" };
    }
    if (row.workspaceId !== workspaceId) {
      // List belongs to a different workspace than the active one.
      // Surface as forbidden — don't leak that the list exists in
      // another workspace.
      return { kind: "forbidden" };
    }
    if (!WRITE_ROLES.includes(row.role as ListRole)) {
      return { kind: "forbidden" };
    }
    if (row.archivedAt) {
      return { kind: "not_found" };
    }
    return { kind: "ok", listId: row.id, listName: row.name, emoji: row.emoji };
  }

  // 2 + 3. Name-based match (only over user's writable lists in this workspace).
  if (ref.listName) {
    const candidates = await db
      .select({
        id: lists.id,
        name: lists.name,
        emoji: lists.emoji,
      })
      .from(lists)
      .innerJoin(listMembers, eq(listMembers.listId, lists.id))
      .where(
        and(
          eq(listMembers.userId, userId),
          inArray(listMembers.role, WRITE_ROLES),
          isNull(lists.archivedAt),
          eq(lists.workspaceId, workspaceId),
        ),
      );

    const trimmed = ref.listName.trim();
    const lower = trimmed.toLowerCase();

    // 2a. Exact case-insensitive match.
    const exact = candidates.filter(
      (c) => c.name.toLowerCase() === lower,
    );
    if (exact.length === 1 && exact[0]) {
      return {
        kind: "ok",
        listId: exact[0].id,
        listName: exact[0].name,
        emoji: exact[0].emoji,
      };
    }
    if (exact.length > 1) {
      return {
        kind: "ambiguous",
        candidates: exact.map((c) => ({ id: c.id, name: c.name })),
      };
    }

    // 2b. Fuzzy substring match.
    const fuzzy = candidates.filter((c) =>
      c.name.toLowerCase().includes(lower),
    );
    if (fuzzy.length === 1 && fuzzy[0]) {
      return {
        kind: "ok",
        listId: fuzzy[0].id,
        listName: fuzzy[0].name,
        emoji: fuzzy[0].emoji,
      };
    }
    if (fuzzy.length > 1) {
      return {
        kind: "ambiguous",
        candidates: fuzzy.map((c) => ({ id: c.id, name: c.name })),
      };
    }
    // zero matches → fall through to inbox or not_found.
  }

  if (opts.inboxFallback) {
    // Inbox is now per-workspace (Phase 4.5 schema): one inbox per
    // workspace, regardless of who owns the workspace. Find the
    // Inbox bound to ctx.workspaceId.
    const inbox = await db
      .select({ id: lists.id, name: lists.name, emoji: lists.emoji })
      .from(lists)
      .where(
        and(
          eq(lists.workspaceId, workspaceId),
          eq(lists.isInbox, true),
        ),
      )
      .limit(1);
    const inboxRow = inbox[0];
    if (inboxRow) {
      return {
        kind: "ok",
        listId: inboxRow.id,
        listName: inboxRow.name,
        emoji: inboxRow.emoji,
      };
    }
    // Inbox missing — `/start` should have created one. Treat as
    // not_found rather than crash.
    return { kind: "not_found" };
  }

  return { kind: "not_found" };
}

/**
 * Detect whether a parsed `dueAt` string lies in the past. Past values
 * are silently dropped per the contract; caller surfaces a warning.
 */
export function isPast(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

/**
 * Helper: ILIKE-friendly query escape. Postgres treats `%` and `_` as
 * wildcards in `LIKE` / `ILIKE`; if the user's search term contains
 * them, we escape so they're matched literally.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/**
 * Drizzle transaction handle type — extracted from the db.transaction
 * callback so helpers can accept it without re-deriving the type.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Phase 14d: when an item's `deadline_at` changes, recompute the
 * concrete `remind_at` of every `before_deadline` reminder for that
 * item. Always called inside the same transaction that wrote the new
 * deadline so the offset reminders never desync.
 *
 * Behavior:
 *   - newDeadline === null → delete every `before_deadline` reminder
 *     for this item. Orphan offsets are meaningless without an anchor.
 *     Absolute reminders are NOT touched.
 *   - newDeadline non-null → SQL-level UPDATE setting
 *     `remind_at = newDeadline - offset_minutes * interval '1 minute'`,
 *     `sent = false`, `updated_at = now()`. Re-arming on deadline move
 *     is intentional — moving the deadline is a new ping context.
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
  // postgres-js doesn't auto-serialize Date in `sql` template literals
  // — pass an ISO string explicitly. Without this we get:
  // "TypeError: ... Received an instance of Date" from the driver and
  // the whole transaction rolls back on save.
  const deadlineIso = newDeadline.toISOString();
  await tx.execute(sql`
    update item_reminders
       set remind_at = ${deadlineIso}::timestamptz - (offset_minutes * interval '1 minute'),
           sent = false,
           updated_at = now()
     where item_id = ${itemId}
       and kind = 'before_deadline'
  `);
}

/** Re-exports for executor convenience. */
export { ilike };
