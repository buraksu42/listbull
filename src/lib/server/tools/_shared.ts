/**
 * Shared internals for tool executors. Cross-cutting invariants live
 * here so each executor stays focused on its tool's specific logic.
 *
 * - `ItemSnapshot` factory (Inv-5): JSON-safe shape for activity_log.
 * - List resolution (Inv-3): list_id → exact name → fuzzy → Inbox.
 * - Membership rejection envelopes (Inv-2).
 * - Error envelope helpers (Inv-4).
 */
import { and, eq, ilike, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { listMembers, lists } from "@/lib/db/schema";
import { toItemSnapshot } from "@/lib/db/snapshots";
import type { ListRole } from "@/lib/types";

/**
 * `toItemSnapshot` is re-exported from the layer-neutral `db/snapshots.ts`
 * (Phase 4 · P2-7). Existing executor imports (`from "./_shared"`) keep
 * working unchanged; the canonical home is now `@/lib/db/snapshots`.
 */
export { toItemSnapshot };

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
 * Per Inv-3: resolve a list reference to a single list_id.
 * 1. If `listId` is provided AND the user has write access → ok.
 * 2. Else `listName` exact case-insensitive match → ok.
 * 3. Else `listName` single fuzzy match (ILIKE %name%) → ok.
 * 4. Else multi-fuzzy → ambiguous (caller surfaces error).
 * 5. Else if `inboxFallback` → user's inbox.
 * 6. Else → not_found.
 *
 * Membership filter is applied throughout — we only consider lists the
 * user is an owner|editor of. A list_id pointing to a list the user
 * lacks access to → forbidden (Inv-2).
 */
export async function resolveList(
  userId: string,
  ref: { listId?: string; listName?: string },
  opts: ResolveOpts = {},
): Promise<ListResolution> {
  // 1. explicit id wins.
  if (ref.listId) {
    const explicit = await db
      .select({
        id: lists.id,
        name: lists.name,
        emoji: lists.emoji,
        role: listMembers.role,
        archivedAt: lists.archivedAt,
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
    if (!WRITE_ROLES.includes(row.role as ListRole)) {
      return { kind: "forbidden" };
    }
    if (row.archivedAt) {
      return { kind: "not_found" };
    }
    return { kind: "ok", listId: row.id, listName: row.name, emoji: row.emoji };
  }

  // 2 + 3. Name-based match (only over user's writable lists).
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
    const inbox = await db
      .select({ id: lists.id, name: lists.name, emoji: lists.emoji })
      .from(lists)
      .where(and(eq(lists.ownerId, userId), eq(lists.isInbox, true)))
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

/** Re-exports for executor convenience. */
export { ilike };
