/**
 * Force-reply action context lookups (Phase 17b).
 *
 * Replaces the user-visible `[ctx:...]` marker — we persist the
 * (chatId, messageId) → action mapping when the bot sends a
 * force-reply prompt, then look it up by reply_to_message.message_id
 * on the reply.
 *
 * Lifetime is short (24h cleanup via cleanup-stale.ts cron); if a
 * user replies to an older force-reply we treat it as an ordinary
 * message.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { botActionContexts } from "@/lib/db/schema";

export type BotActionContext = {
  chatId: number;
  messageId: number;
  action: "edit" | "deadline" | "reminder" | "attach" | "set_key";
  itemId: string | null;
  targetChatId: number | null;
};

export async function insertBotActionContext(
  input: Omit<BotActionContext, "messageId"> & { messageId: number },
): Promise<void> {
  await db
    .insert(botActionContexts)
    .values({
      chatId: input.chatId,
      messageId: input.messageId,
      action: input.action,
      itemId: input.itemId,
      targetChatId: input.targetChatId,
    })
    .onConflictDoNothing();
}

export async function getBotActionContext(
  chatId: number,
  messageId: number,
): Promise<BotActionContext | null> {
  const [row] = await db
    .select()
    .from(botActionContexts)
    .where(
      and(
        eq(botActionContexts.chatId, chatId),
        eq(botActionContexts.messageId, messageId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    chatId: row.chatId,
    messageId: row.messageId,
    action: row.action as BotActionContext["action"],
    itemId: row.itemId,
    targetChatId: row.targetChatId,
  };
}
