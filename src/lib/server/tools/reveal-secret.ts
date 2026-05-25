/**
 * Executor: `reveal_secret` (Phase 17b memory mode — hardened).
 *
 * Threat: if the decrypted value reaches the LLM, it lands in the
 * messages table AND the next OpenRouter request payload. To keep
 * plaintext in a single short-lived path, the executor sends the
 * value DIRECTLY to the chat via the Telegram Bot API and returns
 * only metadata (label + last-4 suffix + delivered flag) to the
 * dispatcher. The LLM never sees the plaintext.
 *
 * Chat-scoped: a secret reveals only in the chat it belongs to. DM
 * secrets reveal in DMs; group-scoped secrets reveal in their group
 * (the 15s-TTL side-channel message is the bot's own and is
 * deletable in groups without admin).
 */
import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items, pendingSecretDeletions } from "@/lib/db/schema";
import {
  revealSecretInputSchema,
  type RevealSecretOutput,
} from "@/lib/ai/tools";
import { decrypt } from "@/lib/server/encryption";
import { decodeSecretPayload } from "@/lib/server/secret-payload";
import { env } from "@/lib/env";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

const TELEGRAM_API = "https://api.telegram.org";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function executeRevealSecret(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<RevealSecretOutput>> {
  const parsed = revealSecretInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }

  // Chat-scoped: a secret is revealable only in the chat it belongs
  // to (the id+chatId filter below). DM secrets stay in DMs; a
  // group-scoped secret (saved via /password run inside that group)
  // reveals in that group. The 15s-TTL side-channel message is the
  // bot's own → deletable in groups without admin.
  const [row] = await db
    .select({
      id: items.id,
      text: items.text,
      kind: items.kind,
      secretEncrypted: items.secretEncrypted,
    })
    .from(items)
    .where(
      and(
        eq(items.id, parsed.data.item_id),
        eq(items.chatId, ctx.chatId),
        isNull(items.archivedAt),
      ),
    )
    .limit(1);
  if (!row) return err(ERR.not_found, "Secret not found.");
  if (row.kind !== "secret" || !row.secretEncrypted) {
    return err(ERR.not_found, "Item is not a secret.");
  }

  let decrypted: string;
  try {
    decrypted = decrypt(row.secretEncrypted);
  } catch (e) {
    console.error("[reveal_secret] decrypt failed", {
      itemId: row.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return err(
      "internal_error",
      "Couldn't decrypt that secret — re-add via /password.",
    );
  }

  // Decode the {username,password} payload. Legacy entries (raw
  // password string, no JSON marker) come back as username:null.
  const payload = decodeSecretPayload(decrypted);
  const suffix =
    payload.password.length >= 4
      ? payload.password.slice(-4)
      : payload.password;

  // Side-channel: deliver the value as its own Telegram message so
  // it never enters the LLM context. We use raw fetch (same as
  // send_item_attachments) to avoid threading a grammy Context
  // through the dispatcher.
  //
  // HTML <code> wraps each value so Telegram renders it as a
  // monospaced tap-to-copy span. Label + username + password are all
  // HTML-escaped because the user controls them.
  const labelHtml = escapeHtml(row.text);
  const passwordHtml = escapeHtml(payload.password);
  const usernameLine = payload.username
    ? `\n👤 <code>${escapeHtml(payload.username)}</code>`
    : "";
  const safeBody = `🔒 <b>${labelHtml}</b>${usernameLine}\n🔑 <code>${passwordHtml}</code>\n\n⏱ Bu mesaj 15 saniye sonra otomatik silinecek. Hemen kopyala (uzun-bas → Kopyala).`;
  let deliveredMessageId: number | null = null;
  try {
    const res = await fetch(
      `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: ctx.chatId,
          text: safeBody,
          parse_mode: "HTML",
        }),
      },
    );
    const json = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (!json.ok) {
      console.error("[reveal_secret] sendMessage failed", {
        itemId: row.id,
        desc: json.description,
      });
      return err(
        "internal_error",
        "Couldn't deliver the secret to chat.",
      );
    }
    deliveredMessageId = json.result?.message_id ?? null;
  } catch (e) {
    console.error("[reveal_secret] sendMessage threw", {
      itemId: row.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return err("internal_error", "Telegram delivery failed.");
  }

  // Audit: label + last-4 only. Never the plaintext.
  await db.insert(activityLog).values({
    chatId: ctx.chatId,
    entityType: "item",
    entityId: row.id,
    action: "secret_revealed",
    actorId: ctx.userId,
    payloadBefore: null,
    payloadAfter: { label: row.text, suffix },
  });

  // Schedule TTL deletion. Two layers:
  //   1. Durable row in pending_secret_deletions (cron sweep is the
  //      floor — survives pod restart, fires within one cron tick
  //      after fire_at, worst-case ~75s).
  //   2. In-process setTimeout for the fast happy path (15s exactly
  //      when the pod stays up). On success it also deletes the
  //      pending row so the cron sweep skips it.
  //
  // The two paths converge safely: if both race, the second
  // deleteMessage call gets a Telegram error (message gone) which we
  // already ignore, and the second DELETE returns 0 rows affected.
  if (deliveredMessageId !== null) {
    const targetMsgId = deliveredMessageId;
    const fireAt = new Date(Date.now() + 15_000);
    try {
      await db
        .insert(pendingSecretDeletions)
        .values({
          chatId: ctx.chatId,
          messageId: targetMsgId,
          fireAt,
        })
        .onConflictDoNothing({
          target: [
            pendingSecretDeletions.chatId,
            pendingSecretDeletions.messageId,
          ],
        });
    } catch (e) {
      // Even if the durable insert fails, the in-process timer
      // still fires — degraded but not broken.
      console.warn("[reveal_secret] pending-deletion insert failed", {
        itemId: row.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    setTimeout(() => {
      void (async () => {
        try {
          await fetch(
            `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                chat_id: ctx.chatId,
                message_id: targetMsgId,
              }),
            },
          );
        } catch (e) {
          console.warn("[reveal_secret] deferred delete failed", {
            itemId: row.id,
            messageId: targetMsgId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        // Drop the pending row regardless of Telegram's response —
        // it's already handled (either deleted or unreachable).
        try {
          await db
            .delete(pendingSecretDeletions)
            .where(
              and(
                eq(pendingSecretDeletions.chatId, ctx.chatId),
                eq(pendingSecretDeletions.messageId, targetMsgId),
              ),
            );
        } catch {
          // ignore — cron sweep will eventually clean up
        }
      })();
    }, 15_000);
  }

  return ok({ label: row.text, suffix, delivered: true });
}
