/**
 * Executor: `start_checklist_run` (Phase 16).
 *
 * Inv-1 transactional flow:
 *   1. Resolve the target list (write access required).
 *   2. Verify `is_checklist=true`; otherwise `not_a_checklist`.
 *   3. If a run is open → close it first (snapshot stats captured).
 *   4. Reset every active item: `is_done=false`, `status='open'`,
 *      `completed_at=null`. `text`, `description`, `deadline_at`,
 *      `priority`, `tags`, `assignee_id` are preserved.
 *   5. Open a new `list_runs` row (`itemsTotal` = active item count
 *      AT THE MOMENT of reset, AFTER step 4).
 *   6. Two activity_log rows: `checklist_run_completed` (if any was
 *      closed) + `checklist_run_started` (always).
 */
import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items, listRuns, lists } from "@/lib/db/schema";
import {
  startChecklistRunInputSchema,
  type StartChecklistRunOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, resolveList, toListRunSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeStartChecklistRun(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<StartChecklistRunOutput>> {
  const parsed = startChecklistRunInputSchema.safeParse(input);
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
        "This list is not a checklist. Toggle is_checklist=true via update_list first.",
      );
    }

    // Step 3: close any open run, capture stats.
    const [activeRun] = await tx
      .select()
      .from(listRuns)
      .where(
        and(eq(listRuns.listId, parent.id), isNull(listRuns.completedAt)),
      )
      .limit(1);

    let closedPreviousRunId: string | null = null;
    if (activeRun) {
      // Count is_done items in this list (active only).
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
      if (closedRun) {
        closedPreviousRunId = closedRun.id;
        await tx.insert(activityLog).values({
          listId: parent.id,
          entityType: "list",
          entityId: parent.id,
          action: "checklist_run_completed",
          actorId: ctx.userId,
          payloadBefore: toListRunSnapshot(activeRun),
          payloadAfter: toListRunSnapshot(closedRun),
        });
      }
    }

    // Step 4: reset every active item to open.
    const resetRes = await tx
      .update(items)
      .set({
        isDone: false,
        status: "open",
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(items.listId, parent.id), isNull(items.archivedAt)),
      )
      .returning({ id: items.id });
    const itemsReset = resetRes.length;

    // Step 5: open a new run (itemsTotal = active item count post-reset).
    const [newRun] = await tx
      .insert(listRuns)
      .values({
        listId: parent.id,
        startedByUserId: ctx.userId,
        itemsTotal: itemsReset,
      })
      .returning();
    if (!newRun) throw new Error("start-checklist-run: insert returned no row");

    // Step 6: activity_log for the new run.
    await tx.insert(activityLog).values({
      listId: parent.id,
      entityType: "list",
      entityId: parent.id,
      action: "checklist_run_started",
      actorId: ctx.userId,
      payloadBefore: null,
      payloadAfter: toListRunSnapshot(newRun),
    });

    return ok({
      list: {
        id: parent.id,
        name: parent.name,
        emoji: parent.emoji,
      },
      run: {
        id: newRun.id,
        list_id: newRun.listId,
        started_at: newRun.startedAt.toISOString(),
        items_total: newRun.itemsTotal,
      },
      closed_previous_run_id: closedPreviousRunId,
      items_reset: itemsReset,
    });
  });
}
