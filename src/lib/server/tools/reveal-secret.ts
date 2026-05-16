/**
 * Executor: `reveal_secret` (Phase 17b memory mode).
 *
 * Decrypt and return a stored credential. DM-only. The encryption
 * envelope is base64(iv||authTag||ciphertext); ENV_KEY is the master
 * key. Activity log records a "secret_revealed" event with the
 * label only — the plaintext never lands in any log or message row.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, chats, items } from "@/lib/db/schema";
import {
  revealSecretInputSchema,
  type RevealSecretOutput,
} from "@/lib/ai/tools";
import { decrypt } from "@/lib/server/encryption";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeRevealSecret(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<RevealSecretOutput>> {
  const parsed = revealSecretInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }

  // DM-only guard. Groups never get to see credentials even if the
  // LLM tries.
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
  } catch (err) {
    console.error("[reveal_secret] decrypt failed", {
      itemId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return ok({
      label: row.text,
      value: "(decrypt failed — re-add via /password)",
    });
  }

  // Audit: label only, never the value.
  await db.insert(activityLog).values({
    chatId: ctx.chatId,
    entityType: "item",
    entityId: row.id,
    action: "secret_revealed",
    actorId: ctx.userId,
    payloadBefore: null,
    payloadAfter: { label: row.text, suffix: value.slice(-4) },
  });

  return ok({ label: row.text, value });
}
