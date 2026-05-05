/**
 * Executor: `set_item_attributes` — set status / priority / tags on
 * an existing item.
 *
 * Status dual-writes is_done for backward compat (status='done' →
 * is_done=true; any other status → is_done=false). Tags REPLACE the
 * array; pass [] to clear. Workspace-wide tag vocabulary is capped
 * at 20 unique tags — the executor counts distinct tags in the
 * workspace before allowing a write that introduces a 21st new tag.
 *
 * Writes one `item_edited` activity_log row covering all 3 fields.
 */
import "server-only";

import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items, lists } from "@/lib/db/schema";
import {
  setItemAttributesInputSchema,
  type SetItemAttributesOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toItemSnapshot } from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

const MAX_WORKSPACE_TAGS = 20;

export async function executeSetItemAttributes(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<SetItemAttributesOutput>> {
  const parsed = setItemAttributesInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, status, priority, tags } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(eq(items.id, item_id))
      .limit(1);
    if (!current || current.archivedAt) {
      return err(ERR.not_found, "Item not found.");
    }

    const allowed = await userCanWriteList(
      ctx.userId,
      current.listId,
      ctx.workspaceId,
    );
    if (!allowed) {
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    const changes: Array<"status" | "priority" | "tags"> = [];
    const warnings: string[] = [];
    const patch: Partial<typeof items.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (status !== undefined && status !== current.status) {
      patch.status = status;
      // Dual-write is_done for backward compat with the 17 existing
      // executors that read is_done directly. Phase 5+ may drop the
      // column once full audit confirms no remaining readers.
      patch.isDone = status === "done";
      patch.completedAt =
        status === "done" && current.completedAt === null
          ? new Date()
          : current.completedAt;
      changes.push("status");
    }

    if (priority !== undefined && priority !== current.priority) {
      patch.priority = priority;
      changes.push("priority");
    }

    if (tags !== undefined) {
      // Deduplicate + lowercase tags before comparison.
      const normalized = Array.from(
        new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)),
      );
      const currentSet = new Set(current.tags);
      const sameLength = normalized.length === current.tags.length;
      const sameContent =
        sameLength && normalized.every((t) => currentSet.has(t));
      if (!sameContent) {
        // Tag-vocabulary cap check: count distinct tags currently in
        // use across the workspace, plus the new tags this write
        // introduces. Reject if the union > MAX_WORKSPACE_TAGS.
        const newTags = normalized.filter((t) => !currentSet.has(t));
        if (newTags.length > 0) {
          // Existing workspace vocabulary = distinct tags across all
          // non-archived items in any list in the workspace.
          const workspaceListIds = (
            await tx
              .select({ id: lists.id })
              .from(lists)
              .where(eq(lists.workspaceId, ctx.workspaceId))
          ).map((r) => r.id);

          if (workspaceListIds.length > 0) {
            const vocab = await tx.execute<{ tag: string }>(
              sql`SELECT DISTINCT unnest(tags) AS tag FROM items WHERE list_id IN ${sql.raw(`(${workspaceListIds.map((id) => `'${id}'`).join(",")})`)} AND archived_at IS NULL`,
            );
            const existingVocab = new Set(vocab.map((r) => r.tag));
            const wouldExist = new Set(existingVocab);
            for (const t of newTags) wouldExist.add(t);
            if (wouldExist.size > MAX_WORKSPACE_TAGS) {
              return err(
                "tag_limit_exceeded",
                `Workspace tag vocabulary capped at ${MAX_WORKSPACE_TAGS}; this write would push it to ${wouldExist.size}.`,
              );
            }
          }
        }
        patch.tags = normalized;
        changes.push("tags");
      }
    }

    if (changes.length === 0) {
      return ok({
        item: toItemSnapshot(current),
        status: current.status as "open" | "in_progress" | "blocked" | "done",
        priority: current.priority as "low" | "normal" | "high",
        tags: current.tags,
        changes: [],
      });
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
      listId: updated.listId,
      entityType: "item",
      entityId: updated.id,
      action: "item_edited",
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    return ok({
      item: toItemSnapshot(updated),
      status: updated.status as "open" | "in_progress" | "blocked" | "done",
      priority: updated.priority as "low" | "normal" | "high",
      tags: updated.tags,
      changes,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}

// Silence unused-import warnings for items array helpers we don't
// reference directly (kept for potential future tag-counting variants).
void inArray;
