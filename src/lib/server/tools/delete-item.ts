/**
 * Executor: `delete_item` (Phase 17 chat-only). Soft delete.
 */
import "server-only";

import { and, eq, isNull } from "drizzle-orm";

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

    // Phase 17b: two-step confirmation gate. Even todo items now
    // require the LLM to have explicitly confirmed with the user
    // before the executor touches anything. Memory + secret used to
    // refuse outright; they now go through the same gate so the chat
    // surface can drive a delete after a confirmation prompt.
    if (!parsed.data.confirmed) {
      return err(
        "confirmation_required",
        `Ask the user to confirm before deleting "${current.text}". Phrase: '🗑️ "${current.text}" silinsin mi? Onaylamak için evet / sil / onayla yaz.' Then re-call delete_item with confirmed:true after explicit confirmation.`,
      );
    }

    const now = new Date();
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
      payloadAfter: toItemSnapshot(archived),
    });

    return ok({ item: toItemSnapshot(archived) });
  });
}
