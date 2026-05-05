/**
 * Executor: `search_items`. Read-only — no transaction, no activity_log.
 *
 * - Membership filter via `list_members` JOIN (Inv-2 enforced at query
 *   time; cross-user leak prevented).
 * - Phase 2 search = `ILIKE %query%` on `items.text` (per the spec).
 * - Returns matched items + per-row list context + the list of lists
 *   that were actually scanned, so the LLM can render contextual replies.
 */
import "server-only";

import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists } from "@/lib/db/schema";
import {
  searchItemsInputSchema,
  type SearchItemsOutput,
} from "@/lib/ai/tools";
import { ERR, err, escapeLike, ok, resolveList, toItemSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeSearchItems(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<SearchItemsOutput>> {
  const parsed = searchItemsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const {
    query,
    list_id,
    list_name,
    include_done,
    include_archived,
    limit,
  } = parsed.data;

  // Resolve scope: explicit list reference, or "all writable lists".
  let scopedListIds: string[] | null = null;
  let scopedListNameById = new Map<string, string>();

  if (list_id || list_name) {
    const resolution = await resolveList(
      ctx.userId,
      { listId: list_id, listName: list_name },
      // Don't fall back to inbox for search — explicit references must
      // resolve concretely; ambiguity bubbles up.
      { inboxFallback: false },
    );
    switch (resolution.kind) {
      case "forbidden":
        return err(ERR.forbidden, "You don't have access to that list.");
      case "not_found":
        return err(ERR.not_found, "No matching list found.");
      case "ambiguous": {
        const names = resolution.candidates.map((c) => c.name).join(", ");
        return err(
          ERR.ambiguous_list,
          `List name matched multiple lists: ${names}. Specify which one.`,
        );
      }
    }
    scopedListIds = [resolution.listId];
    scopedListNameById.set(resolution.listId, resolution.listName);
  } else {
    // Cross-list mode: every list the user is a member of (any role —
    // viewers can search even though they can't mutate).
    const membershipRows = await db
      .select({
        id: lists.id,
        name: lists.name,
      })
      .from(lists)
      .innerJoin(listMembers, eq(listMembers.listId, lists.id))
      .where(
        and(
          eq(listMembers.userId, ctx.userId),
          isNull(lists.archivedAt),
        ),
      );
    scopedListIds = membershipRows.map((r) => r.id);
    scopedListNameById = new Map(
      membershipRows.map((r) => [r.id, r.name]),
    );
  }

  if (scopedListIds.length === 0) {
    return ok({
      results: [],
      total_matched: 0,
      searched_lists: [],
    });
  }

  // Build conditions. Empty query → no text filter (caller wants every
  // item in scope, e.g. "ev işlerinde ne var?").
  const conds = [inArray(items.listId, scopedListIds)];
  if (query.length > 0) {
    conds.push(ilike(items.text, `%${escapeLike(query)}%`));
  }
  if (!include_done) conds.push(eq(items.isDone, false));
  if (!include_archived) conds.push(isNull(items.archivedAt));

  // First fetch matching rows (with list info via JOIN).
  const rows = await db
    .select({
      item: items,
      list: {
        id: lists.id,
        name: lists.name,
        emoji: lists.emoji,
      },
    })
    .from(items)
    .innerJoin(lists, eq(items.listId, lists.id))
    .where(and(...conds))
    .orderBy(asc(items.isDone), asc(items.position), asc(items.createdAt))
    .limit(limit);

  // Total matched (for capped pagination feedback). Run a count query
  // separately so the LLM sees the true total even when capped.
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(items)
    .where(and(...conds));
  const count = countRows[0]?.count ?? 0;

  const results = rows.map((r) => ({
    item: toItemSnapshot(r.item),
    list: r.list,
    score: 1, // Phase 2: uniform score; pg_trgm upgrade in Phase 4.
  }));

  const searched_lists = Array.from(scopedListNameById.entries()).map(
    ([id, name]) => ({ id, name }),
  );

  return ok({
    results,
    total_matched: count,
    searched_lists,
  });
}

