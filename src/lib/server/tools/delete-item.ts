/**
 * Executor: `delete_item` (Phase 17 chat-only). Soft delete.
 */
import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import { deleteItemInputSchema, type DeleteItemOutput } from "@/lib/ai/tools";
import { ERR, err, ok, toItemSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeDeleteItem(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<DeleteItemOutput>> {
  const parsed = deleteItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(
        and(
          eq(items.id, parsed.data.item_id),
          eq(items.chatId, ctx.chatId),
          isNull(items.archivedAt),
        ),
      )
      .limit(1);
    if (!current) return err(ERR.not_found, "Item not found.");

    // Phase 17c: when the target is a top-level parent with live
    // sub-items, deletion cascades. We count children up-front so the
    // confirmation phrase mentions them, then archive them in the
    // same tx after the user confirms.
    const isParent = current.parentItemId === null;
    let liveChildCount = 0;
    if (isParent) {
      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(items)
        .where(
          and(
            eq(items.parentItemId, current.id),
            isNull(items.archivedAt),
          ),
        );
      liveChildCount = countRows[0]?.count ?? 0;
    }

    // Phase 17b: two-step confirmation gate. Even todo items now
    // require the LLM to have explicitly confirmed with the user
    // before the executor touches anything. Memory + secret used to
    // refuse outright; they now go through the same gate so the chat
    // surface can drive a delete after a confirmation prompt.
    if (!parsed.data.confirmed) {
      const childSuffix =
        liveChildCount > 0 ? ` ve ${liveChildCount} alt item` : "";
      return err(
        "confirmation_required",
        `Ask the user to confirm before deleting "${current.text}"${childSuffix}. Phrase: '🗑️ "${current.text}"${childSuffix} silinsin mi? Onaylamak için evet / sil / onayla yaz.' Then re-call delete_item with confirmed:true after explicit confirmation.`,
      );
    }

    const now = new Date();

    // Cascade children first so the parent archive timestamp is the
    // last write — keeps the activity_log read like an event stream.
    let cascadedChildren: (typeof items.$inferSelect)[] = [];
    if (isParent && liveChildCount > 0) {
      const childRows = await tx
        .select()
        .from(items)
        .where(
          and(
            eq(items.parentItemId, current.id),
            isNull(items.archivedAt),
          ),
        );
      const archivedChildren = await tx
        .update(items)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(items.parentItemId, current.id),
            isNull(items.archivedAt),
          ),
        )
        .returning();
      cascadedChildren = archivedChildren;
      // Audit row per cascaded child so /memory restore + activity
      // feed see each one individually.
      for (const child of archivedChildren) {
        const before = childRows.find((r) => r.id === child.id);
        if (!before) continue;
        await tx.insert(activityLog).values({
          chatId: ctx.chatId,
          entityType: "item",
          entityId: child.id,
          action: "item_deleted",
          actorId: ctx.userId,
          payloadBefore: toItemSnapshot(before),
          payloadAfter: {
            ...toItemSnapshot(child),
            cascaded_from_parent_id: current.id,
          },
        });
      }
    }

    const [archived] = await tx
      .update(items)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(items.id, current.id))
      .returning();
    if (!archived) throw new Error("delete-item: update returned no row");

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: archived.id,
      action: "item_deleted",
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: {
        ...toItemSnapshot(archived),
        ...(cascadedChildren.length > 0
          ? { children_archived_count: cascadedChildren.length }
          : {}),
      },
    });

    return ok({ item: toItemSnapshot(archived) });
  });
}
