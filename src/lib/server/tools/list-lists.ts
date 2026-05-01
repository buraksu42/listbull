/**
 * Executor: `list_lists`. Read-only — no transaction, no activity_log.
 *
 * Returns every list the caller is a member of (any role) plus per-list
 * counts. Inbox first, then `created_at asc`. Counts via single LEFT
 * JOIN aggregation (no N+1).
 */
import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists } from "@/lib/db/schema";
import {
  listListsInputSchema,
  type ListListsOutput,
} from "@/lib/ai/tools";
import type { ListRole } from "@/lib/types";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeListLists(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<ListListsOutput>> {
  const parsed = listListsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { include_archived } = parsed.data;

  // Aggregate item counts per list. We restrict items to non-archived;
  // open_count adds an `is_done = false` filter via FILTER clause.
  const rows = await db
    .select({
      id: lists.id,
      name: lists.name,
      emoji: lists.emoji,
      isInbox: lists.isInbox,
      archivedAt: lists.archivedAt,
      createdAt: lists.createdAt,
      role: listMembers.role,
      itemCount: sql<number>`count(${items.id}) filter (where ${items.archivedAt} is null and ${items.isDone} = false)::int`,
      openCount: sql<number>`count(${items.id}) filter (where ${items.archivedAt} is null and ${items.isDone} = false)::int`,
      // Item count INCLUDING completed (but excluding archived) — this
      // matches the spec's "archived excluded, completed excluded by
      // default" copy. The output contract distinguishes total from
      // open; we expose both.
      totalCount: sql<number>`count(${items.id}) filter (where ${items.archivedAt} is null)::int`,
    })
    .from(listMembers)
    .innerJoin(lists, eq(listMembers.listId, lists.id))
    .leftJoin(items, eq(items.listId, lists.id))
    .where(eq(listMembers.userId, ctx.userId))
    .groupBy(
      lists.id,
      lists.name,
      lists.emoji,
      lists.isInbox,
      lists.archivedAt,
      lists.createdAt,
      listMembers.role,
    )
    .orderBy(asc(lists.createdAt));

  const filtered = rows.filter((r) => include_archived || !r.archivedAt);

  // Reorder: inbox first, then createdAt asc.
  filtered.sort((a, b) => {
    if (a.isInbox && !b.isInbox) return -1;
    if (!a.isInbox && b.isInbox) return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const out: ListListsOutput = {
    lists: filtered.map((r) => ({
      id: r.id,
      name: r.name,
      emoji: r.emoji,
      is_inbox: r.isInbox,
      role: r.role as ListRole,
      // Per the contract (architecture-pass-phase-2.md § list_lists output):
      // "item_count: archived excluded, completed excluded by default".
      // Both fields surface the open count in Phase 2. If a "total including
      // done" surface is needed later, route via Architect for a contract
      // amendment rather than diverging here.
      item_count: r.openCount,
      open_count: r.openCount,
    })),
  };

  return ok(out);
}

