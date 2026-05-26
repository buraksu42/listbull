/**
 * Executor: `complete_item` (Phase 17 chat-only).
 *
 * Toggle is_done. When the item has a task_recurrence_rule AND is
 * being completed, we CLONE the item: the original is marked done
 * (lands in /done as the audit trail of "I did it today"), and a
 * fresh row is inserted with the same text / description / priority
 * / tags / reminders / attachments / recurrence rule but anchored at
 * the next RRULE occurrence. A 'task_recurred' warning is returned
 * alongside the new item snapshot so callers can surface "🔁 yeni
 * açıldı: <text> — <deadline>" to the user.
 *
 * If the rule has no further occurrence (UNTIL= past) or the item
 * has no deadline anchor, we fall back to normal completion — a
 * recurring item with no deadline still cycles off NOW so the user
 * doesn't get stuck with an item that won't close.
 */
import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import {
  completeItemInputSchema,
  type CompleteItemOutput,
} from "@/lib/ai/tools";
import { nextOccurrence } from "@/lib/server/recurrence";
import {
  cloneRecurringItemAsNextCycle,
  ERR,
  err,
  ok,
  rollupParentDoneState,
  toItemSnapshot,
} from "./_shared";

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

    // Phase 17c: checklist gate. A top-level todo with open sub-items
    // cannot be completed in one step — the LLM must surface the open
    // children to the user and either bulk-complete them first or get
    // explicit permission. Uncompleting (is_done=false) bypasses this.
    if (is_done && current.parentItemId === null && current.kind === "todo") {
      const openChildren = await tx
        .select({ id: items.id, text: items.text })
        .from(items)
        .where(
          and(
            eq(items.parentItemId, current.id),
            eq(items.isDone, false),
            isNull(items.archivedAt),
          ),
        );
      if (openChildren.length > 0) {
        const preview = openChildren
          .slice(0, 5)
          .map((c) => `"${c.text}"`)
          .join(", ");
        const extra =
          openChildren.length > 5
            ? ` ve ${openChildren.length - 5} tane daha`
            : "";
        return err(
          "gate_blocked",
          `Parent has ${openChildren.length} open sub-item(s): ${preview}${extra}. ` +
            `Ask the user: "${openChildren.length} alt item açık (${preview}${extra}). Önce onları bitirelim mi yoksa hepsini birden tamamladım mı diyim?" ` +
            `If they say "hepsini" / "all" / "evet hepsi", call complete_item on each child id first, then retry the parent.`,
        );
      }
    }

    const warnings: string[] = [];
    const now = new Date();

    // Recurrence clone: anchor on the CURRENT deadline if present
    // (so a delayed "missed pill today" still advances to tomorrow's
    // natural slot, not 24h from completion time). Fall back to NOW
    // when there's no deadline — natural-language paths ("her gün süt
    // al") can set a rule without a deadline. Without this fallback
    // the item would silently mark done and drop to /done with no
    // clone, which is the exact opposite of "this repeats".
    let nextCycleDeadline: Date | null = null;
    if (is_done && current.taskRecurrenceRule) {
      const anchor = current.deadlineAt ?? now;
      const next = nextOccurrence(current.taskRecurrenceRule, anchor);
      if (next) {
        nextCycleDeadline = next;
        warnings.push("task_recurred");
      }
      // next === null → rule exhausted (UNTIL= past) or malformed.
      // Fall through to normal completion so the user isn't stuck
      // with an item that won't close.
    }

    // Mark the (original) item done — when we're cloning, the
    // original is the audit trail row that lands in /done.
    const [updated] = await tx
      .update(items)
      .set({
        isDone: is_done,
        status: is_done ? "done" : "open",
        completedAt: is_done ? now : null,
        updatedAt: now,
      })
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) throw new Error("complete-item: update returned no row");

    let newItemSnapshot: ReturnType<typeof toItemSnapshot> | undefined;
    if (nextCycleDeadline) {
      const clone = await cloneRecurringItemAsNextCycle(
        tx,
        current,
        nextCycleDeadline,
        ctx.userId,
      );
      newItemSnapshot = toItemSnapshot(clone);
    }

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: updated.id,
      action: is_done ? "item_completed" : "item_uncompleted",
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    // Auto-rollup parent done state when the changed item is a child.
    // No-op for top-level / non-todo / RRULE parents.
    await rollupParentDoneState(tx, updated.id, ctx.chatId, ctx.userId);

    return ok({
      item: toItemSnapshot(updated),
      ...(newItemSnapshot ? { new_item: newItemSnapshot } : {}),
      ...(warnings.length ? { warnings } : {}),
    });
  });
}
