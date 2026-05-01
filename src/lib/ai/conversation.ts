/**
 * Conversation history slicing for LLM context assembly.
 *
 * Backend's `handle-message.ts` loads the most-recent N rows from the
 * `messages` table (ordered desc by `created_at`) and hands them here.
 * This module trims to the budget and converts DB rows into the
 * provider-neutral `ConversationMessage` shape `respond.ts` consumes.
 *
 * Pure functions — no DB access, no LLM call. Lives in AI-agent's tree
 * because the slicing rule belongs to the LLM context-window contract,
 * not the persistence layer.
 *
 * Slicing rule (Inv-6 from `docs/architecture-pass-phase-2.md`):
 *   Walk newest → oldest, accumulate until EITHER 30 messages OR
 *   ~24,000 chars of cumulative `content`. Whichever limit hits first
 *   wins; older messages are dropped. Then reverse to chronological
 *   order before sending to the LLM.
 *
 * 24,000 chars ≈ 6,000 tokens at the industry "4 chars per token"
 * heuristic — under-counts non-Latin scripts but is the documented
 * rule of thumb. `tool_calls` JSON is NOT counted; each call is small
 * and bounded.
 */
import type {
  ConversationMessage,
  MessageWithToolCalls,
} from "@/lib/types";

/** Default cap on number of messages retained. */
export const DEFAULT_MAX_MESSAGES = 30;

/** Default cap on cumulative `content` chars (~6k tokens). */
export const DEFAULT_MAX_CHARS = 24_000;

export type SliceOptions = {
  maxMessages?: number;
  maxChars?: number;
};

/**
 * Cheap token estimate. 4 chars per token is the industry heuristic;
 * close enough for context-window budgeting.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Trim a desc-ordered DB row list to the LLM's context budget and
 * convert to `ConversationMessage[]` in chronological order.
 *
 * @param messages  DB rows ordered NEWEST first (desc by created_at).
 *                  Backend's query helper is responsible for the order.
 * @param opts      Override the message / char caps.
 * @returns         `ConversationMessage[]` in CHRONOLOGICAL order,
 *                  ready to splice between system prompt and the
 *                  current user turn.
 */
export function sliceForContext(
  messages: MessageWithToolCalls[],
  opts: SliceOptions = {},
): ConversationMessage[] {
  const maxMessages = opts.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  // Walk newest → oldest; stop when either cap is hit.
  const kept: MessageWithToolCalls[] = [];
  let chars = 0;

  for (const msg of messages) {
    if (kept.length >= maxMessages) break;
    const next = chars + msg.content.length;
    if (kept.length > 0 && next > maxChars) break;
    // Always keep at least one message even if it alone exceeds the
    // char budget — better to send a truncated context than nothing.
    kept.push(msg);
    chars = next;
  }

  // Reverse to chronological order, then map to provider-neutral shape.
  return kept.reverse().map(rowToConversationMessage);
}

/**
 * Convert a `messages` table row (with parsed `toolCalls` JSONB) into
 * the discriminated union `ConversationMessage` consumed by `respond.ts`.
 * Out-of-range roles are dropped to 'user' as a defensive default —
 * the DB enum should make this unreachable, but the type system can't
 * prove it.
 */
function rowToConversationMessage(
  row: MessageWithToolCalls,
): ConversationMessage {
  switch (row.role) {
    case "user":
      return { role: "user", content: row.content };
    case "assistant":
      return {
        role: "assistant",
        content: row.content,
        ...(row.toolCalls && row.toolCalls.length > 0
          ? { toolCalls: row.toolCalls }
          : {}),
      };
    case "tool":
      return {
        role: "tool",
        // tool_call_id is non-null on tool rows by DB invariant; coerce
        // to empty string defensively to satisfy the union type.
        toolCallId: row.toolCallId ?? "",
        content: row.content,
      };
    default:
      // DB column is text-typed (not enum) so the role string isn't
      // narrowed to a literal union; treat unrecognized values as user
      // text. Never expected at runtime — Backend writes only the
      // three valid roles.
      return { role: "user", content: row.content };
  }
}
