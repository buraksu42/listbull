/**
 * Executor: `attach_file_to_item` (Phase 17 chat-only).
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  itemAttachments,
  items,
} from "@/lib/db/schema";
import {
  attachFileToItemInputSchema,
  type AttachFileToItemOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toAttachmentSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeAttachFileToItem(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<AttachFileToItemOutput>> {
  const parsed = attachFileToItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const d = parsed.data;

  return await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, d.item_id), eq(items.chatId, ctx.chatId)))
      .limit(1);
    if (!item) return err(ERR.not_found, "Item not found.");

    const [created] = await tx
      .insert(itemAttachments)
      .values({
        itemId: d.item_id,
        chatId: ctx.chatId,
        kind: d.kind,
        telegramFileId: d.file_id,
        telegramFileUniqueId: d.file_unique_id ?? null,
        mimeType: d.mime_type ?? null,
        fileSize: d.file_size ?? null,
        durationSeconds: d.duration ?? null,
        width: d.width ?? null,
        height: d.height ?? null,
        thumbnailFileId: d.thumbnail_file_id ?? null,
        originalFilename: d.filename ?? null,
        uploadedByUserId: ctx.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      // Dedup hit. Fetch existing.
      const [existing] = await tx
        .select()
        .from(itemAttachments)
        .where(
          and(
            eq(itemAttachments.itemId, d.item_id),
            eq(itemAttachments.telegramFileUniqueId, d.file_unique_id ?? ""),
          ),
        )
        .limit(1);
      if (!existing) {
        return err(ERR.internal_error, "attachment insert race.");
      }
      return ok({
        attachment: {
          id: existing.id,
          item_id: existing.itemId,
          kind: existing.kind,
          telegram_file_id: existing.telegramFileId,
          mime_type: existing.mimeType,
          file_size: existing.fileSize,
        },
      });
    }

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "item",
      entityId: d.item_id,
      action: "item_attachment_added",
      actorId: ctx.userId,
      payloadBefore: null,
      payloadAfter: toAttachmentSnapshot(created),
    });

    return ok({
      attachment: {
        id: created.id,
        item_id: created.itemId,
        kind: created.kind,
        telegram_file_id: created.telegramFileId,
        mime_type: created.mimeType,
        file_size: created.fileSize,
      },
    });
  });
}
