/**
 * AI-internal types (Phase 17 chat-only).
 *
 * `ToolCall`, `ToolResult` owned by Architect in `src/lib/types/index.ts`;
 * we import and re-export so consumers in this tree have one obvious
 * place to look.
 */
import type { ToolCall, ToolResult } from "@/lib/types";

export type { ToolCall, ToolResult } from "@/lib/types";

export type ToolDispatcher = (call: ToolCall) => Promise<ToolResult>;

/**
 * Input to `respond()`. Caller (Backend) supplies plaintext API key,
 * pre-sliced messages, and user/chat context for the system prompt.
 */
export type RespondInput = {
  /** Conversation history including the current user turn at the END. */
  messages: import("@/lib/types").ConversationMessage[];
  user: {
    locale: string;
    firstName: string;
    timezone: string;
  };
  /**
   * Phase 17: chat context for the system prompt — replaces the old
   * workspace summary. `isOwner` = caller is the chat owner (only
   * owners can set the API key, etc.).
   */
  chat: {
    chatId: number;
    title: string | null;
    type: "private" | "group" | "supergroup";
    isOwner: boolean;
  };
  apiKey: string;
  model: string;
  toolDispatcher: ToolDispatcher;
};

export type RespondOutput = {
  assistantText: string;
  toolCalls: ToolCall[];
  persistedMessages: import("@/lib/types").ConversationMessage[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    costUsdMicro: number;
    providerReportedCost: boolean;
  };
};
