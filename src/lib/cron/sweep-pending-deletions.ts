/**
 * Pending-secret-deletion sweep (M5, security audit).
 *
 * Restart-safe floor for `reveal_secret`'s 15s auto-delete. The
 * in-process setTimeout still handles the happy path; this sweep
 * picks up rows the pod missed (crash before timer fired) on the
 * next cron tick.
 *
 * Best-effort Telegram deleteMessage — if it 400s (message already
 * gone, e.g. happy-path timer beat us), we still drop the row.
 * Telegram bots can delete their own messages without time limits,
 * so age isn't a concern.
 */
import "server-only";

import { and, eq, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { pendingSecretDeletions } from "@/lib/db/schema";
import { env } from "@/lib/env";

const TELEGRAM_API = "https://api.telegram.org";

// Cron tick is 60s, so a generous batch keeps the table draining
// even after a brief pod outage. Bigger batches risk a long sweep
// blocking the rest of the tick — 200 is comfortable.
const PICKUP_LIMIT = 200;

export async function dispatchPendingSecretDeletions(): Promise<{
  picked: number;
  deleted: number;
  failed: number;
}> {
  const rows = await db
    .select({
      chatId: pendingSecretDeletions.chatId,
      messageId: pendingSecretDeletions.messageId,
    })
    .from(pendingSecretDeletions)
    .where(lte(pendingSecretDeletions.fireAt, sql`NOW()`))
    .limit(PICKUP_LIMIT);

  if (rows.length === 0) return { picked: 0, deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;

  for (const r of rows) {
    let telegramOk = true;
    try {
      const res = await fetch(
        `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: r.chatId,
            message_id: r.messageId,
          }),
        },
      );
      if (!res.ok) {
        // 400 here means "message_to_delete_not_found" or similar —
        // happy-path setTimeout likely won the race. Still drop the
        // pending row; nothing more we can do.
        telegramOk = false;
      }
    } catch {
      telegramOk = false;
    }

    try {
      await db
        .delete(pendingSecretDeletions)
        .where(
          and(
            eq(pendingSecretDeletions.chatId, r.chatId),
            eq(pendingSecretDeletions.messageId, r.messageId),
          ),
        );
      if (telegramOk) deleted++;
      else failed++;
    } catch (e) {
      // DB drop failed — log and move on. Next tick will retry.
      failed++;
      console.warn("[sweep-pending-deletions] row delete failed", {
        chatId: r.chatId,
        messageId: r.messageId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { picked: rows.length, deleted, failed };
}
