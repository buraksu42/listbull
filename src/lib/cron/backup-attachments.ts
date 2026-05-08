/**
 * Phase 14b: hybrid attachment backup cron.
 *
 * Pickup: rows with `storage_backed_up_at IS NULL`, oldest first
 * (rides on the `item_attachments_backup_queue_idx` partial index).
 * Per-row: download via the bot API, upload to Hetzner Object Storage
 * at `attachments/{workspace_id}/{item_id}/{attachment_id}.{ext}`,
 * mark backed-up.
 *
 * Hetzner not configured → skip silently. The Mini App keeps serving
 * via the Telegram CDN; backups remain pending until the operator
 * fills in the env vars.
 *
 * 20MB cap: `bot.api.getFile` returns a `file_path`, but Telegram's
 * file CDN only serves files ≤20MB to bots. Larger payloads return
 * HTTP 400 / 413; we surface that as a per-row warning + leave
 * `storage_backed_up_at` null. A future migration can add
 * `backup_skipped_reason` to make this discoverable in the Mini App.
 *
 * Idempotent: claim batch uses `WHERE storage_backed_up_at IS NULL`
 * + `LIMIT N`. A second concurrent cron tick that picks the same
 * row will harmlessly re-PUT the same key (object storage is
 * last-write-wins) and re-flip the column to a slightly newer
 * timestamp.
 */
import "server-only";

import { asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { itemAttachments } from "@/lib/db/schema";
import { getBot } from "@/lib/server/bot";
import {
  objectStorageConfigured,
  uploadAndPresign,
} from "@/lib/server/object-storage";

const BATCH_LIMIT = 20;

/** Storage path: groups by workspace → item → attachment id. */
function storageKey(args: {
  workspaceId: string;
  itemId: string;
  attachmentId: string;
  filename: string | null;
  mimeType: string | null;
}): string {
  const ext = guessExtension(args.filename, args.mimeType);
  return `attachments/${args.workspaceId}/${args.itemId}/${args.attachmentId}${ext}`;
}

function guessExtension(
  filename: string | null,
  mimeType: string | null,
): string {
  if (filename) {
    const dot = filename.lastIndexOf(".");
    if (dot > 0 && dot < filename.length - 1) {
      const ext = filename.slice(dot).toLowerCase();
      if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
    }
  }
  if (!mimeType) return "";
  const subtype = mimeType.split("/")[1]?.toLowerCase() ?? "";
  if (!subtype) return "";
  // Trim parameter suffixes like 'video/mp4; codecs=...'.
  const clean = subtype.split(";")[0]?.trim() ?? subtype;
  if (!/^[a-z0-9-]+$/.test(clean)) return "";
  // Conservative remap for common cases.
  const remap: Record<string, string> = {
    jpeg: ".jpg",
    "x-icon": ".ico",
    "svg+xml": ".svg",
    "ogg": ".ogg",
    "mp4": ".mp4",
    "webm": ".webm",
    "pdf": ".pdf",
    "msword": ".doc",
    "vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "plain": ".txt",
  };
  if (remap[clean]) return remap[clean] as string;
  return `.${clean}`;
}

/**
 * Batch backup pass. Returns counters so a parent cron can log a
 * summary. Each row is best-effort: a single failure doesn't abort
 * the batch.
 */
export async function backupAttachmentsBatch(): Promise<{
  picked: number;
  uploaded: number;
  failed: number;
  skipped: number;
}> {
  if (!objectStorageConfigured()) {
    return { picked: 0, uploaded: 0, failed: 0, skipped: 0 };
  }

  const rows = await db
    .select()
    .from(itemAttachments)
    .where(isNull(itemAttachments.storageBackedUpAt))
    .orderBy(asc(itemAttachments.createdAt))
    .limit(BATCH_LIMIT);

  if (rows.length === 0) {
    return { picked: 0, uploaded: 0, failed: 0, skipped: 0 };
  }

  let bot;
  try {
    bot = await getBot();
  } catch (e) {
    console.error("[backup-attachments] bot init failed", e);
    return { picked: rows.length, uploaded: 0, failed: rows.length, skipped: 0 };
  }

  let uploaded = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const file = await bot.api.getFile(row.telegramFileId);
      if (!file.file_path) {
        skipped += 1;
        continue;
      }
      // 20MB Telegram bot-CDN cap — surfaced as an HTTP 4xx by
      // `getFile` itself for some files; double-check by file_size
      // when we have it.
      if (row.fileSize !== null && row.fileSize > 20 * 1024 * 1024) {
        skipped += 1;
        continue;
      }
      const tgUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
      const resp = await fetch(tgUrl);
      if (!resp.ok) {
        console.warn("[backup-attachments] download failed", {
          attachmentId: row.id,
          status: resp.status,
        });
        failed += 1;
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      const key = storageKey({
        workspaceId: row.workspaceId,
        itemId: row.itemId,
        attachmentId: row.id,
        filename: row.originalFilename,
        mimeType: row.mimeType,
      });
      const result = await uploadAndPresign(
        key,
        buf,
        row.mimeType ?? "application/octet-stream",
      );
      if (!result) {
        failed += 1;
        continue;
      }
      await db
        .update(itemAttachments)
        .set({
          storageKey: key,
          storageBackedUpAt: new Date(),
        })
        .where(eq(itemAttachments.id, row.id));
      uploaded += 1;
    } catch (e) {
      console.error("[backup-attachments] row failed", {
        attachmentId: row.id,
        error: String(e),
      });
      failed += 1;
    }
  }

  return { picked: rows.length, uploaded, failed, skipped };
}
