/**
 * AI-internal types. Public, AI-tree-only.
 *
 * `ToolCall`, `ToolResult`, `ConversationMessage`, `MessageWithToolCalls`,
 * `ItemSnapshot` are owned by Architect in `src/lib/types/index.ts`;
 * we import and re-export so consumers in this tree have one obvious
 * place to look.
 */
import type { ToolCall, ToolResult } from "@/lib/types";

export type { ToolCall, ToolResult } from "@/lib/types";

/**
 * Backend supplies this callable when invoking `respond.ts`. AI-agent
 * never executes side effects directly — that's `src/lib/server/tools/**`'s
 * job. The orchestrator wires the dispatcher to the per-user, per-tool
 * execution context (auth, DB transaction, activity_log).
 *
 * The dispatcher MUST return successfully even when the underlying tool
 * fails — the `output` carries the error envelope (`{ ok: false, error }`)
 * which `respond.ts` forwards verbatim to the LLM as a tool-result
 * message. Throwing is reserved for unrecoverable infra issues
 * (DB down, etc.); `respond.ts` will surface those to the caller.
 */
export type ToolDispatcher = (call: ToolCall) => Promise<ToolResult>;

/**
 * Input to `respond()`. The user's BYOK API key is passed in plaintext
 * by the caller (Backend decrypted it from `users.openrouter_api_key_encrypted`).
 * AI-agent never reads env or DB directly for this.
 */
export type RespondInput = {
  /**
   * Conversation history including the current user turn at the END.
   * Caller (Backend) is responsible for slicing via `sliceForContext`
   * and appending the new user message before calling `respond`.
   */
  messages: import("@/lib/types").ConversationMessage[];
  user: {
    /** BCP-47 (e.g. "tr", "en"). */
    locale: string;
    /** Telegram first_name; appears in the system prompt. */
    firstName: string;
    /** IANA timezone (e.g. "Europe/Istanbul"). */
    timezone: string;
  };
  /**
   * Phase 4.5: workspace context summary for the system prompt.
   * Active workspace + every workspace the user belongs to. Caller
   * (Backend's handle-message) builds this via
   * `listWorkspacesForUser(userId)`.
   */
  workspaces: Array<{
    id: string;
    name: string;
    tier: string;
    role: string;
    isPersonal: boolean;
    isActive: boolean;
  }>;
  /** Plaintext OpenRouter API key (the caller decrypted it). */
  apiKey: string;
  /** OpenRouter model id, e.g. "anthropic/claude-sonnet-4". */
  model: string;
  /** Backend-provided executor entry point. */
  toolDispatcher: ToolDispatcher;
};

/**
 * Output of `respond()`.
 *
 * `assistantText` is the final user-facing reply (last assistant turn's
 * text content). `toolCalls` lists every tool the LLM actually invoked
 * during this round (in invocation order) — useful for telemetry.
 *
 * `persistedMessages` is the full sequence of NEW messages this turn
 * produced (excluding the user's original input — caller persists
 * that). Backend appends them to the `messages` table in order.
 */
export type RespondOutput = {
  assistantText: string;
  toolCalls: ToolCall[];
  persistedMessages: import("@/lib/types").ConversationMessage[];
};
