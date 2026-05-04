/**
 * Executor: `delete_list` — soft-delete with confirm-on-non-empty.
 *
 * Inbox cannot be deleted. Lists with active items require explicit
 * `confirm: true`. Items are not mutated; only the list's `archived_at`
 * is set, hiding it from `listListsForUser`. Restore via restore_list
 * within the standard 30-day audit window.
 */
import "server-only";

import { and, eq, ilike, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items, listMembers, lists } from "@/lib/db/schema";
import {
  deleteListInputSchema,
  type DeleteListOutput,
} from "@/lib/ai/tools";
import { toListSnapshot } from "@/lib/db/snapshots";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeDeleteList(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<DeleteListOutput>> {
  const parsed = deleteListInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { list_id, list_name, confirm } = parsed.data;

  const found = await resolveOwnedActiveList(ctx.userId, list_id, list_name);
  if (found.kind === "not_found") {
    return err(ERR.not_found, "No list found you own with that id/name.");
  }
  if (found.kind === "ambiguous") {
    return err(
      ERR.ambiguous_list,
      `Multiple lists matched: ${found.candidates.join(", ")}.`,
    );
  }
  const target = found.list;

  if (target.isInbox) {
    return err(
      "cannot_delete_inbox",
      "Inbox is the default capture list and cannot be deleted.",
    );
  }

  // Active item count for the confirm gate.
  const activeRows = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.listId, target.id), isNull(items.archivedAt)));
  const activeCount = activeRows.length;

  if (activeCount > 0 && !confirm) {
    return ok({
      list_id: target.id,
      active_item_count: activeCount,
      requires_confirm: true,
    });
  }

  return await db.transaction(async (tx) => {
    // Single timestamp for both list + item archive — restore_list later
    // matches on this exact timestamp to pick the right cascade set
    // (items archived BEFORE this delete stay archived; only items
    // archived AS PART OF this delete come back).
    const archivedAt = new Date();

    // Cascade-archive every active item in the list.
    const cascadeItemIds = activeRows.map((r) => r.id);
    if (cascadeItemIds.length > 0) {
      await tx
        .update(items)
        .set({ archivedAt, updatedAt: archivedAt })
        .where(and(eq(items.listId, target.id), isNull(items.archivedAt)));
    }

    const [updated] = await tx
      .update(lists)
      .set({ archivedAt, updatedAt: archivedAt })
      .where(eq(lists.id, target.id))
      .returning();
    if (!updated) throw new Error("delete-list: update returned no row");

    await tx.insert(activityLog).values({
      listId: target.id,
      entityType: "list",
      entityId: target.id,
      action: "list_archived",
      actorId: ctx.userId,
      payloadBefore: toListSnapshot(target),
      payloadAfter: {
        ...toListSnapshot(updated),
        cascadeItemIds,
      },
    });

    return ok({
      list_id: target.id,
      active_item_count: activeCount,
    });
  });
}

type Resolution =
  | { kind: "ok"; list: typeof lists.$inferSelect }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: string[] };

async function resolveOwnedActiveList(
  userId: string,
  list_id: string | undefined,
  list_name: string | undefined,
): Promise<Resolution> {
  if (list_id) {
    const row = await db.query.lists.findFirst({
      where: and(eq(lists.id, list_id), isNull(lists.archivedAt)),
    });
    if (!row) return { kind: "not_found" };
    const member = await db.query.listMembers.findFirst({
      where: and(
        eq(listMembers.listId, row.id),
        eq(listMembers.userId, userId),
        eq(listMembers.role, "owner"),
      ),
    });
    if (!member) return { kind: "not_found" };
    return { kind: "ok", list: row };
  }

  const rows = await db
    .select({ list: lists })
    .from(listMembers)
    .innerJoin(lists, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, userId),
        eq(listMembers.role, "owner"),
        ilike(lists.name, list_name ?? ""),
        isNull(lists.archivedAt),
      ),
    );
  if (rows.length === 0) return { kind: "not_found" };
  if (rows.length > 1) {
    return {
      kind: "ambiguous",
      candidates: rows.map((r) => r.list.name),
    };
  }
  const first = rows[0];
  if (!first) return { kind: "not_found" };
  return { kind: "ok", list: first.list };
}
