/**
 * Executor: `search_items` (Phase 17 chat-only).
 *
 * ILIKE on items.text + items.description, scoped to ctx.chatId.
 * Empty query → most-recent items. has_reminder filter adds an
 * EXISTS clause against item_reminders (future, unsent).
 */
import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { itemReminders, items } from "@/lib/db/schema";
import {
  searchItemsInputSchema,
  type SearchItemsOutput,
} from "@/lib/ai/tools";
import { ERR, err, escapeLike, ok, toItemSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeSearchItems(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<SearchItemsOutput>> {
  const parsed = searchItemsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const {
    query,
    include_done,
    include_archived,
    has_reminder,
    kind,
    limit,
  } = parsed.data;

  const conds = [eq(items.chatId, ctx.chatId)];
  if (!include_done) conds.push(eq(items.isDone, false));
  if (!include_archived) conds.push(isNull(items.archivedAt));
  // 'any' opts out of the filter entirely; the default 'todo' keeps
  // pre-Phase-17b call sites returning the same rows as before.
  if (kind !== "any") conds.push(eq(items.kind, kind));

  if (query.trim().length > 0) {
    const pattern = `%${escapeLike(query.trim())}%`;
    conds.push(
      sql`(${items.text} ILIKE ${pattern} OR ${items.description} ILIKE ${pattern})`,
    );
  }

  if (has_reminder) {
    conds.push(
      sql`EXISTS (
        SELECT 1 FROM ${itemReminders}
        WHERE ${itemReminders.itemId} = ${items.id}
          AND ${itemReminders.sent} = false
          AND ${itemReminders.remindAt} > NOW()
      )`,
    );
  }

  const rows = await db
    .select()
    .from(items)
    .where(and(...conds))
    .orderBy(desc(items.createdAt))
    .limit(limit);

  return ok({
    results: rows.map((row) => ({
      item: toItemSnapshot(row),
      score: 1.0,
    })),
    total_matched: rows.length,
  });
}

// Reference unused user_id so tree-shake doesn't strip in test stubs.
export function __chatContext(_userId: string, _chatId: number): void {
  // Intentionally empty.
}
