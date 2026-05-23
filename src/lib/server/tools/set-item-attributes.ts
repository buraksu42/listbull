/**
 * Executor: `set_item_attributes` (Phase 17 chat-only).
 *
 * Status / priority / tags. Tag limit: 20 unique tags per chat.
 */
import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import {
  setItemAttributesInputSchema,
  type SetItemAttributesOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toItemSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

const TAG_LIMIT_PER_CHAT = 20;

export async function executeSetItemAttributes(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<SetItemAttributesOutput>> {
  const parsed = setItemAttributesInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, status, priority, tags, kind } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, item_id), eq(items.chatId, ctx.chatId)))
      .limit(1);
    if (!current) return err(ERR.not_found, "Item not found.");
    if (kind !== undefined && current.kind === "secret") {
      // Secrets are bound to the /şifre flow — refuse silent
      // re-kinding so a credential never accidentally surfaces in
      // the /items view.
      return err(
        "protected",
        "Secrets are managed only via the /şifre flow.",
      );
    }

    const changes: Array<"status" | "priority" | "tags" | "kind"> = [];
    const patch: Partial<typeof items.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (status !== undefined && status !== current.status) {
      patch.status = status;
      if (status === "done") {
        patch.isDone = true;
        patch.completedAt = new Date();
      } else if (current.status === "done") {
        patch.isDone = false;
        patch.completedAt = null;
      }
      changes.push("status");
    }
    if (priority !== undefined && priority !== current.priority) {
      patch.priority = priority;
      changes.push("priority");
    }
    if (tags !== undefined) {
      const normalized = Array.from(
        new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t)),
      );
      // Per-chat tag-vocabulary cap (20 unique). The chat_id filter
      // also stops a cross-chat item_id from polluting the count
      // and either falsely tripping or falsely bypassing the limit.
      const rows = await tx.execute<{ count: number }>(sql`
        SELECT COUNT(DISTINCT t)::int AS count
        FROM (
          SELECT unnest(tags) AS t FROM ${items}
          WHERE chat_id = ${ctx.chatId}
            AND id <> ${item_id}
            AND archived_at IS NULL
        ) sub
      `);
      const usedTags = Number(rows[0]?.count ?? 0);
      const totalAfter = usedTags + new Set(normalized).size;
      if (totalAfter > TAG_LIMIT_PER_CHAT) {
        return err(
          "tag_limit_exceeded",
          `Tag limit (${TAG_LIMIT_PER_CHAT}) exceeded for this chat.`,
        );
      }
      patch.tags = normalized;
      changes.push("tags");
    }
    if (kind !== undefined && kind !== current.kind) {
      patch.kind = kind;
      changes.push("kind");
    }

    if (changes.length === 0) {
      return ok({ item: toItemSnapshot(current), changes: [] });
    }

    const [updated] = await tx
      .update(items)
      .set(patch)
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) {
      throw new Error("set-item-attributes: update returned no row");
    }

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: updated.id,
      action: "item_edited",
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    // silence unused-imports
    void ne;

    return ok({ item: toItemSnapshot(updated), changes });
  });
}
