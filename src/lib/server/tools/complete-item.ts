/**
 * Executor: `complete_item` (Phase 17 chat-only).
 *
 * Toggle is_done. When the item has a task_recurrence_rule AND is
 * being completed, we KEEP it open and surface a 'task_recurred'
 * warning so the LLM/caller can advance the deadline in a follow-up.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import {
  completeItemInputSchema,
  type CompleteItemOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toItemSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeCompleteItem(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<CompleteItemOutput>> {
  const parsed = completeItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, is_done } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, item_id), eq(items.chatId, ctx.chatId)))
      .limit(1);
    if (!current) return err(ERR.not_found, "Item not found.");
    if (current.kind === "memory" || current.kind === "secret") {
      // Memory rows have no done semantic. Refuse so the LLM tells
      // the user "Hafıza item'ları işaretlenmiyor — silmek istersen
      // /memory'den onaylayabilirsin."
      return err(
        "protected",
        `Memory items have no done state. Reply: "Hafıza item'ları işaretlenmez."`,
      );
    }

    const warnings: string[] = [];
    const now = new Date();
    const patch: Partial<typeof items.$inferInsert> = {
      isDone: is_done,
      status: is_done ? "done" : "open",
      completedAt: is_done ? now : null,
      updatedAt: now,
    };

    if (is_done && current.taskRecurrenceRule) {
      patch.isDone = false;
      patch.status = "open";
      patch.completedAt = null;
      warnings.push("task_recurred");
    }

    const [updated] = await tx
      .update(items)
      .set(patch)
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) throw new Error("complete-item: update returned no row");

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: updated.id,
      action: is_done ? "item_completed" : "item_uncompleted",
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    return ok({
      item: toItemSnapshot(updated),
      ...(warnings.length ? { warnings } : {}),
    });
  });
}
