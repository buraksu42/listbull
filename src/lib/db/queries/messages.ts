/**
 * Conversation history query helpers.
 *
 * `messages` is append-only in Phase 2 (the `/reset` command in Phase 3
 * will introduce DELETE-WHERE). Reads return the parsed
 * `MessageWithToolCalls` shape so the LLM context assembler doesn't have
 * to re-do the JSONB cast at every call site.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { messages } from "@/lib/db/schema";
import type {
  MessageWithToolCalls,
  NewMessage,
  ToolCall,
} from "@/lib/types";

/**
 * Last `limit` messages for a (user, chat) pair, ordered NEWEST first.
 * Slicing in `src/lib/ai/conversation.ts` walks the result newest →
 * oldest and reverses internally — caller doesn't need to re-order.
 */
export async function getRecentMessages(
  userId: string,
  chatId: number,
  limit = 30,
): Promise<MessageWithToolCalls[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.chatId, chatId)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.map(parseRow);
}

/**
 * Append a single message row. Returns the persisted row (with
 * generated `id` and `createdAt`) parsed back to the public shape.
 */
export async function insertMessage(
  values: NewMessage,
): Promise<MessageWithToolCalls> {
  const [row] = await db.insert(messages).values(values).returning();
  if (!row) throw new Error("insertMessage: insert returned no row");
  return parseRow(row);
}

/**
 * Batch-insert several message rows in chronological order. All rows
 * share the same `userId`/`chatId` in normal use; the function doesn't
 * enforce this — it's a thin wrapper around the bulk insert.
 *
 * Returns inserted rows in the order they were supplied.
 */
export async function insertMessages(
  values: NewMessage[],
): Promise<MessageWithToolCalls[]> {
  if (values.length === 0) return [];
  const rows = await db.insert(messages).values(values).returning();
  return rows.map(parseRow);
}

/**
 * F1 export — all messages across every chat for one user, ordered
 * oldest → newest. Used by `src/lib/server/export.ts` to assemble
 * the user's conversation history for the export bundle.
 *
 * Caller-only filter (Inv-20): rows where `user_id = userId`. Other
 * users' conversation rows never appear, even if they share a chat.
 */
export async function getAllMessagesForUser(
  userId: string,
): Promise<Array<{
  role: string;
  content: string;
  createdAt: Date;
}>> {
  return db
    .select({
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(messages.createdAt);
}

/**
 * Phase 3 `/reset` command: delete every conversation row for a
 * (user, chat) pair. This is the ONLY DELETE-WHERE on `messages`
 * (Inv-7). Returns the number of rows actually deleted.
 */
export async function clearConversation(
  userId: string,
  chatId: number,
): Promise<number> {
  const rows = await db
    .delete(messages)
    .where(and(eq(messages.userId, userId), eq(messages.chatId, chatId)))
    .returning({ id: messages.id });
  return rows.length;
}

/**
 * Convert a raw Drizzle row (with jsonb `toolCalls: unknown`) into the
 * public `MessageWithToolCalls` shape. Defensive — bad jsonb yields
 * `null` rather than throwing, matching the AI-side rowToConversationMessage
 * fallback policy.
 */
function parseRow(
  row: typeof messages.$inferSelect,
): MessageWithToolCalls {
  let parsed: ToolCall[] | null = null;
  if (Array.isArray(row.toolCalls)) {
    parsed = row.toolCalls as ToolCall[];
  } else if (row.toolCalls === null || row.toolCalls === undefined) {
    parsed = null;
  } else {
    // Unexpected jsonb shape (e.g. an object). Coerce to null; do not crash.
    parsed = null;
  }
  return {
    ...row,
    toolCalls: parsed,
  };
}
