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
 * DM-only at the chat layer too — the chats row must be type
 * 'private'. Groups are refused with a friendly nudge.
 */
import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, chats, items } from "@/lib/db/schema";
import {
  revealSecretInputSchema,
  type RevealSecretOutput,
} from "@/lib/ai/tools";
import { decrypt } from "@/lib/server/encryption";
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

  // DM-only guard. Groups never get to see credentials even if the
  // LLM somehow tries to call this.
  const [chat] = await db
    .select({ type: chats.type })
    .from(chats)
    .where(eq(chats.chatId, ctx.chatId))
    .limit(1);
  if (!chat || chat.type !== "private") {
    return err(
      "forbidden",
      "Secrets can only be revealed in DM. Reply: '🔒 Bu chat'te güvenli değil. DM'imde sor.'",
    );
  }

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

  let value: string;
  try {
    value = decrypt(row.secretEncrypted);
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

  const suffix = value.length >= 4 ? value.slice(-4) : value;

  // Side-channel: deliver the value as its own Telegram message so
  // it never enters the LLM context. We use raw fetch (same as
  // send_item_attachments) to avoid threading a grammy Context
  // through the dispatcher.
  //
  // HTML <code> wraps the value so Telegram renders it as a
  // monospaced inline span — tap-to-copy on mobile, click-select
  // on desktop. Closest the Bot API gets to "auto clipboard".
  // Both label and value are HTML-escaped because the user controls
  // them; an "<script>" or "&" in either would otherwise corrupt
  // the message.
  const labelHtml = escapeHtml(row.text);
  const valueHtml = escapeHtml(value);
  const safeBody = `🔒 <b>${labelHtml}</b>\n\n<code>${valueHtml}</code>\n\n⏱ Bu mesaj 15 saniye sonra otomatik silinecek. Hemen kopyala (uzun-bas → Kopyala).`;
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

  // Schedule TTL deletion. Plaintext stays in Telegram for 15s max
  // (best-effort: relies on this container staying up; if it crashes
  // before the timer fires the user must delete manually). Telegram
  // bots may delete their own messages without time restrictions.
  if (deliveredMessageId !== null) {
    const targetMsgId = deliveredMessageId;
    setTimeout(() => {
      void fetch(
        `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: ctx.chatId,
            message_id: targetMsgId,
          }),
        },
      ).catch((e: unknown) => {
        // User may have deleted it themselves first; ignore.
        console.warn("[reveal_secret] deferred delete failed", {
          itemId: row.id,
          messageId: targetMsgId,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }, 15_000);
  }

  return ok({ label: row.text, suffix, delivered: true });
}
