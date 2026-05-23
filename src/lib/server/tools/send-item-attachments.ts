/**
 * Executor: `send_item_attachments` (Phase 17b memory mode).
 *
 * Pull every attachment for the given item and re-send each via the
 * Telegram Bot API (sendPhoto / sendVideo / sendDocument / etc.).
 * The file_id stays the same as long as the bot token is unchanged,
 * so we don't need to re-upload.
 *
 * Talks to Telegram via raw fetch so the executor doesn't need a
 * grammy Context handed in by the caller.
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { itemAttachments, items } from "@/lib/db/schema";
import {
  sendItemAttachmentsInputSchema,
  type SendItemAttachmentsOutput,
} from "@/lib/ai/tools";
import { env } from "@/lib/env";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

const TELEGRAM_API = "https://api.telegram.org";

const METHOD_BY_KIND: Record<string, { method: string; field: string }> = {
  photo: { method: "sendPhoto", field: "photo" },
  video: { method: "sendVideo", field: "video" },
  audio: { method: "sendAudio", field: "audio" },
  voice: { method: "sendVoice", field: "voice" },
  video_note: { method: "sendVideoNote", field: "video_note" },
  document: { method: "sendDocument", field: "document" },
};

export async function executeSendItemAttachments(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<SendItemAttachmentsOutput>> {
  const parsed = sendItemAttachmentsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }

  const [item] = await db
    .select({ text: items.text })
    .from(items)
    .where(
      and(
        eq(items.id, parsed.data.item_id),
        eq(items.chatId, ctx.chatId),
      ),
    )
    .limit(1);
  if (!item) return err(ERR.not_found, "Item not found.");

  const attachments = await db
    .select()
    .from(itemAttachments)
    .where(
      and(
        eq(itemAttachments.itemId, parsed.data.item_id),
        // Defense-in-depth: don't re-send another chat's files even
        // if a stale item_id slips through the parent item check.
        eq(itemAttachments.chatId, ctx.chatId),
      ),
    )
    .orderBy(asc(itemAttachments.createdAt));

  let sent = 0;
  for (const a of attachments) {
    const method = METHOD_BY_KIND[a.kind] ?? METHOD_BY_KIND.document!;
    try {
      const res = await fetch(
        `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method.method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: ctx.chatId,
            [method.field]: a.telegramFileId,
          }),
        },
      );
      const json = (await res.json()) as { ok: boolean; description?: string };
      if (json.ok) {
        sent++;
      } else {
        console.error("[send_item_attachments] telegram error", {
          attId: a.id,
          method: method.method,
          desc: json.description,
        });
      }
    } catch (err) {
      console.error("[send_item_attachments] fetch failed", {
        attId: a.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return ok({ sent, label: item.text });
}
