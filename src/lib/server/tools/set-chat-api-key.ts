/**
 * Executor: `set_chat_api_key` (Phase 17).
 *
 * Persists an OpenRouter API key on the active chat's row. Owner-only.
 * Telegram-side hygiene (auto-delete user message + redact in history)
 * lives in handle-message.ts.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, chats } from "@/lib/db/schema";
import {
  setChatApiKeyInputSchema,
  type SetChatApiKeyOutput,
} from "@/lib/ai/tools";
import { encrypt } from "@/lib/server/encryption";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeSetChatApiKey(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<SetChatApiKeyOutput>> {
  const parsed = setChatApiKeyInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }

  const [chat] = await db
    .select()
    .from(chats)
    .where(eq(chats.chatId, ctx.chatId))
    .limit(1);
  if (!chat) return err(ERR.not_found, "Chat not found.");
  if (chat.ownerUserId !== ctx.userId) {
    return err(
      ERR.forbidden,
      "Only the chat owner can set the OpenRouter API key.",
    );
  }

  const cipher = encrypt(parsed.data.api_key);
  const suffix = parsed.data.api_key.slice(-4);

  await db.transaction(async (tx) => {
    await tx
      .update(chats)
      .set({
        openrouterApiKeyEncrypted: cipher,
        updatedAt: new Date(),
      })
      .where(eq(chats.chatId, ctx.chatId));

    await tx.insert(activityLog).values({
      chatId: ctx.chatId,
      entityType: "chat",
      entityId: ctx.userId, // placeholder — activity for chats uses owner_id as entity ref
      action: "chat_api_key_set",
      actorId: ctx.userId,
      payloadBefore: { api_key_set: chat.openrouterApiKeyEncrypted !== null },
      payloadAfter: { api_key_set: true, key_suffix: suffix },
    });
  });

  return ok({
    chat: { chat_id: chat.chatId, title: chat.title },
    key_suffix: suffix,
  });
}
