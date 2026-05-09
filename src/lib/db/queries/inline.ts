/**
 * D1 — bot inline mode read query (Phase 4).
 *
 * `@listbull_bot <query>` in any Telegram chat surfaces up to 10
 * most-recent items across the user's lists. Deterministic + fast — no
 * LLM ranking. ILIKE search over `items.text`, scoped to lists where
 * the caller is a member (any role: owner / editor / viewer can search
 * their own list contents).
 *
 * Limit cap: 10 (per Architect's contract — sub-100ms latency target).
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists } from "@/lib/db/schema";

export const INLINE_RESULT_CAP = 10;

/**
 * Escape Postgres `LIKE` / `ILIKE` wildcards (`%`, `_`, `\`) so user
 * input is matched literally. Inlined here to keep `db/queries/**` a
 * leaf layer (no imports from `server/**`); the same helper exists in
 * `src/lib/server/tools/_shared.ts` for executor consumers.
 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

export type InlineSearchRow = {
  itemId: string;
  itemText: string;
  itemIsDone: boolean;
  /** ISO 8601. Used to render "added X minutes ago" client-side. */
  itemCreatedAt: string;
  listId: string;
  listName: string;
  listEmoji: string | null;
};

/**
 * Fetch up to `INLINE_RESULT_CAP` items for the inline-query surface.
 *
 * - `query` empty → most-recent items across user's lists
 * - `query` non-empty → ILIKE `%query%` on `items.text`, ranked by
 *   `items.created_at` desc
 *
 * Both branches:
 *   - Filter to lists where the caller has a `list_members` row.
 *   - Skip archived items + archived lists.
 */
export async function searchInlineItems(
  userId: string,
  query: string,
): Promise<InlineSearchRow[]> {
  const trimmed = query.trim();
  const conds = [
    eq(listMembers.userId, userId),
    isNull(items.archivedAt),
    isNull(lists.archivedAt),
  ];

  if (trimmed.length > 0) {
    const escaped = escapeLike(trimmed);
    conds.push(sql`${items.text} ILIKE ${"%" + escaped + "%"}`);
  }

  const rows = await db
    .select({
      itemId: items.id,
      itemText: items.text,
      itemIsDone: items.isDone,
      itemCreatedAt: items.createdAt,
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(and(...conds))
    .orderBy(desc(items.createdAt))
    .limit(INLINE_RESULT_CAP);

  return rows.map((r) => ({
    itemId: r.itemId,
    itemText: r.itemText,
    itemIsDone: r.itemIsDone,
    itemCreatedAt: r.itemCreatedAt.toISOString(),
    listId: r.listId,
    listName: r.listName,
    listEmoji: r.listEmoji,
  }));
}

export type InlineListRow = {
  listId: string;
  listName: string;
  listEmoji: string | null;
  /** Open (un-done, un-archived) item count, for the result subtitle. */
  openCount: number;
};

/**
 * Fetch up to `INLINE_RESULT_CAP` lists for the inline-query surface.
 *
 * - `query` empty → most-recently-created lists across the user's
 *   memberships.
 * - `query` non-empty → ILIKE `%query%` on `lists.name`, ranked by
 *   `lists.created_at` desc.
 *
 * Skips archived lists. Includes a per-list `openCount` so the result
 * card can render "5 open" / "5 açık". The count is computed in a
 * subquery rather than a JOIN so the row count stays bounded.
 */
export async function searchInlineLists(
  userId: string,
  query: string,
): Promise<InlineListRow[]> {
  const trimmed = query.trim();
  const conds = [
    eq(listMembers.userId, userId),
    isNull(lists.archivedAt),
  ];
  if (trimmed.length > 0) {
    const escaped = escapeLike(trimmed);
    conds.push(sql`${lists.name} ILIKE ${"%" + escaped + "%"}`);
  }

  const rows = await db
    .select({
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
      openCount: sql<number>`(
        SELECT count(*)::int FROM ${items}
        WHERE ${items.listId} = ${lists.id}
          AND ${items.isDone} = false
          AND ${items.archivedAt} IS NULL
      )`,
    })
    .from(lists)
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(and(...conds))
    .orderBy(desc(lists.createdAt))
    .limit(INLINE_RESULT_CAP);

  return rows.map((r) => ({
    listId: r.listId,
    listName: r.listName,
    listEmoji: r.listEmoji,
    openCount: r.openCount,
  }));
}
