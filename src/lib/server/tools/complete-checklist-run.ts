/**
 * Executor: `complete_checklist_run` (Phase 16).
 *
 * Closes the active run on a checklist list. Items are NOT reset.
 * Idempotent — when no active run exists, returns `closed: false`
 * with `run: null` rather than an error.
 */
import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items, listRuns, lists } from "@/lib/db/schema";
import {
  completeChecklistRunInputSchema,
  type CompleteChecklistRunOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, resolveList, toListRunSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeCompleteChecklistRun(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<CompleteChecklistRunOutput>> {
  const parsed = completeChecklistRunInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { list_id, list_name } = parsed.data;

  const resolution = await resolveList(
    ctx,
    { listId: list_id, listName: list_name },
    { inboxFallback: false },
  );
  switch (resolution.kind) {
    case "forbidden":
      return err(ERR.forbidden, "You don't have access to that list.");
    case "not_found":
      return err(ERR.not_found, "List not found.");
    case "ambiguous": {
      const names = resolution.candidates.map((c) => c.name).join(", ");
      return err(
        ERR.ambiguous_list,
        `List name matched multiple lists: ${names}.`,
      );
    }
  }

  return await db.transaction(async (tx) => {
    const [parent] = await tx
      .select()
      .from(lists)
      .where(eq(lists.id, resolution.listId))
      .limit(1);
    if (!parent || parent.archivedAt) {
      return err(ERR.not_found, "List not found.");
    }
    if (!parent.isChecklist) {
      return err(
        "not_a_checklist",
        "This list is not a checklist.",
      );
    }

    const [activeRun] = await tx
      .select()
      .from(listRuns)
      .where(
        and(eq(listRuns.listId, parent.id), isNull(listRuns.completedAt)),
      )
      .limit(1);

    if (!activeRun) {
      return ok({
        list: {
          id: parent.id,
          name: parent.name,
          emoji: parent.emoji,
        },
        run: null,
        closed: false,
      });
    }

    const doneRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(
        and(
          eq(items.listId, parent.id),
          eq(items.isDone, true),
          isNull(items.archivedAt),
        ),
      );
    const itemsCompleted = doneRows[0]?.count ?? 0;

    const [closedRun] = await tx
      .update(listRuns)
      .set({
        completedAt: new Date(),
        completedByUserId: ctx.userId,
        itemsCompleted,
      })
      .where(eq(listRuns.id, activeRun.id))
      .returning();
    if (!closedRun) {
      throw new Error("complete-checklist-run: update returned no row");
    }

    await tx.insert(activityLog).values({
      listId: parent.id,
      entityType: "list",
      entityId: parent.id,
      action: "checklist_run_completed",
      actorId: ctx.userId,
      payloadBefore: toListRunSnapshot(activeRun),
      payloadAfter: toListRunSnapshot(closedRun),
    });

    return ok({
      list: {
        id: parent.id,
        name: parent.name,
        emoji: parent.emoji,
      },
      run: {
        id: closedRun.id,
        list_id: closedRun.listId,
        started_at: closedRun.startedAt.toISOString(),
        completed_at: (closedRun.completedAt as Date).toISOString(),
        items_total: closedRun.itemsTotal,
        items_completed: closedRun.itemsCompleted ?? 0,
      },
      closed: true,
    });
  });
}
