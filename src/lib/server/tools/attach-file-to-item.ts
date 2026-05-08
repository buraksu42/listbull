/**
 * Executor: `attach_file_to_item` (Phase 14b).
 *
 * Inv-1 transactional INSERT into `item_attachments` + activity_log
 * row (`item_attachment_added`). Permission scoped to write access on
 * the parent item's list.
 *
 * Dedup: when `file_unique_id` is supplied AND the same item already
 * has a row with that unique id, the executor returns the existing
 * row instead of inserting a duplicate (idempotent re-send).
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemAttachments, items, lists } from "@/lib/db/schema";
import {
  attachFileToItemInputSchema,
  type AttachFileToItemOutput,
} from "@/lib/ai/tools";
import {
  ERR,
  err,
  ok,
  toAttachmentSnapshot,
  toItemSnapshot,
} from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

export async function executeAttachFileToItem(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<AttachFileToItemOutput>> {
  const parsed = attachFileToItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const {
    item_id,
    kind,
    file_id,
    file_unique_id,
    mime_type,
    file_size,
    duration,
    width,
    height,
    thumbnail_file_id,
    filename,
  } = parsed.data;

  return await db.transaction(async (tx) => {
    const [parent] = await tx
      .select()
      .from(items)
      .where(eq(items.id, item_id))
      .limit(1);
    if (!parent || parent.archivedAt) {
      return err(ERR.not_found, "Item not found.");
    }

    // Pull the parent list to verify workspace match + write access.
    const [parentList] = await tx
      .select()
      .from(lists)
      .where(eq(lists.id, parent.listId))
      .limit(1);
    if (!parentList || parentList.archivedAt) {
      return err(ERR.not_found, "List not found.");
    }
    if (parentList.workspaceId !== ctx.workspaceId) {
      // Don't leak existence across workspaces.
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    const allowed = await userCanWriteList(
      ctx.userId,
      parent.listId,
      ctx.workspaceId,
    );
    if (!allowed) {
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    // Dedup short-circuit: if the same (item_id, file_unique_id) row
    // already exists, return it instead of writing a duplicate.
    if (file_unique_id) {
      const [existing] = await tx
        .select()
        .from(itemAttachments)
        .where(
          and(
            eq(itemAttachments.itemId, item_id),
            eq(itemAttachments.telegramFileUniqueId, file_unique_id),
          ),
        )
        .limit(1);
      if (existing) {
        return ok({
          attachment: {
            id: existing.id,
            item_id: existing.itemId,
            kind: existing.kind as AttachFileToItemOutput["attachment"]["kind"],
            mime_type: existing.mimeType,
            file_size: existing.fileSize,
            original_filename: existing.originalFilename,
          },
          item: toItemSnapshot(parent),
        });
      }
    }

    const [created] = await tx
      .insert(itemAttachments)
      .values({
        itemId: item_id,
        workspaceId: parentList.workspaceId,
        kind,
        telegramFileId: file_id,
        telegramFileUniqueId: file_unique_id ?? null,
        mimeType: mime_type ?? null,
        fileSize: file_size ?? null,
        durationSeconds: duration ?? null,
        width: width ?? null,
        height: height ?? null,
        thumbnailFileId: thumbnail_file_id ?? null,
        originalFilename: filename ?? null,
        uploadedByUserId: ctx.userId,
      })
      .returning();
    if (!created) {
      throw new Error("attach-file-to-item: insert returned no row");
    }

    await tx.insert(activityLog).values({
      listId: parent.listId,
      entityType: "item",
      entityId: parent.id,
      action: "item_attachment_added",
      actorId: ctx.userId,
      payloadBefore: null,
      payloadAfter: toAttachmentSnapshot(created),
    });

    return ok({
      attachment: {
        id: created.id,
        item_id: created.itemId,
        kind: created.kind as AttachFileToItemOutput["attachment"]["kind"],
        mime_type: created.mimeType,
        file_size: created.fileSize,
        original_filename: created.originalFilename,
      },
      item: toItemSnapshot(parent),
    });
  });
}
