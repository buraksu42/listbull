/**
 * Executor: `get_item_by_position` (Phase 17b).
 *
 * Mirrors the /items view ordering — open items first, then by
 * position, then by createdAt. Returns null when N is out of range
 * (LLM is instructed in the tool description to stop and explain).
 */
import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items } from "@/lib/db/schema";
import {
  getItemByPositionInputSchema,
  type GetItemByPositionOutput,
} from "@/lib/ai/tools";
import { toItemSnapshot } from "@/lib/db/snapshots";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeGetItemByPosition(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<GetItemByPositionOutput>> {
  const parsed = getItemByPositionInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { position } = parsed.data;

  // Same WHERE + ORDER as buildItemsView so the position the user
  // sees is the position we resolve. Phase 17b: scope to kind='todo'
  // + is_done=false — positional refs target the /items view, which
  // only shows OPEN items. Phase 17c: also filter parent_item_id IS
  // NULL — /items hides sub-items under their parent's drill-in, so
  // a bare "5" never refers to a child. Sub-items are addressed by id.
  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.chatId, ctx.chatId),
        eq(items.kind, "todo"),
        eq(items.isDone, false),
        isNull(items.archivedAt),
        isNull(items.parentItemId),
      ),
    )
    .orderBy(asc(items.position), asc(items.createdAt));

  const total = rows.length;
  const row = rows[position - 1];
  return ok({
    item: row ? toItemSnapshot(row) : null,
    total,
  });
}
