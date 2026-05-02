/**
 * LLM orchestration entry point.
 *
 * Backend's bot router calls `respond()` once per inbound user turn.
 * This module:
 *   1. Builds the system prompt + Anthropic message array from the
 *      caller-supplied (and pre-sliced) `ConversationMessage[]`.
 *   2. Hits the Anthropic SDK pointed at OpenRouter's base URL with
 *      the user's BYOK key.
 *   3. If the model emits `tool_use` blocks, dispatches each through
 *      the caller's `ToolDispatcher`, feeds results back as a
 *      `tool_result` user turn, and loops — capped at 5 round-trips
 *      per the contract's runaway guard (Bot ↔ AI ↔ Executor flow).
 *   4. Returns the final assistant text plus the full sequence of NEW
 *      assistant + tool messages produced this turn, so Backend can
 *      persist them to the `messages` table.
 *
 * Side-effect free outside the SDK call and `toolDispatcher` invocations
 * — no DB, no env reads. The caller owns persistence and the Telegram
 * round-trip.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";

import type {
  ConversationMessage,
  ToolCall,
  ToolResult,
} from "@/lib/types";

// rollback: systemPromptV1 from "@/lib/ai/prompts/system.v1"
// rollback: systemPromptV2 from "@/lib/ai/prompts/system.v2"
import { systemPromptV3 } from "@/lib/ai/prompts/system.v3";
import { tools as toolRegistry } from "@/lib/ai/tools";
import type { RespondInput, RespondOutput } from "@/lib/ai/types";

/**
 * Maximum number of LLM ↔ executor round-trips per user turn.
 * Well-behaved sequences finish in 1-2; the cap is a safety belt
 * against runaway loops (per `docs/architecture-pass-phase-2.md`).
 */
export const MAX_TOOL_ROUNDTRIPS = 5;

/** OpenRouter's Anthropic-compatible endpoint. */
// Anthropic SDK appends `/v1/messages` to this base. OpenRouter's
// Anthropic-compat endpoint is `https://openrouter.ai/api/v1/messages`,
// so we use `/api` (no /v1) here — the SDK adds the /v1 itself.
// Wrong: "https://openrouter.ai/api/v1" → request hits /api/v1/v1/messages (404, empty body).
const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

/** Default `max_tokens` for the assistant message. */
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Run a single user turn through the LLM, executing any tool calls the
 * model emits, until the model returns plain text (or the round-trip
 * cap is hit).
 */
export async function respond(input: RespondInput): Promise<RespondOutput> {
  const { messages, user, apiKey, model, toolDispatcher } = input;

  if (!apiKey) {
    // Sentinel reply for Backend to render as a "no key configured"
    // message. Throwing would force Backend to special-case the SDK's
    // own auth error; this is cleaner.
    return {
      assistantText: NO_KEY_SENTINEL,
      toolCalls: [],
      persistedMessages: [
        { role: "assistant", content: NO_KEY_SENTINEL },
      ],
    };
  }

  const client = new Anthropic({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    // OpenRouter doesn't enforce the Anthropic version header; sending
    // the SDK's default is fine.
  });

  const system = systemPromptV3({
    userLocale: user.locale,
    userFirstName: user.firstName,
    userTimezone: user.timezone,
  });

  // Anthropic-shaped tool list — convert each zod schema to JSON Schema.
  const anthropicTools: AnthropicTool[] = toolRegistry.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToInputSchema(t.inputSchema),
  }));

  // Build the running message buffer. The caller is responsible for
  // including the new user turn at the end; we don't append anything
  // before the first SDK call.
  const buffer: MessageParam[] = conversationToMessageParams(messages);

  // Track new messages produced this turn (excludes the user's input).
  const persisted: ConversationMessage[] = [];
  const toolCallsSeen: ToolCall[] = [];

  let lastAssistantText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDTRIPS; round++) {
    const response = await client.messages.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      system,
      tools: anthropicTools,
      messages: buffer,
    });

    const { textParts, toolUseBlocks } = splitContent(response.content);
    const assistantText = textParts.join("\n").trim();
    lastAssistantText = assistantText;

    // Persist this assistant turn (text + any tool calls in JSONB).
    const turnToolCalls: ToolCall[] = toolUseBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input,
    }));
    if (turnToolCalls.length > 0) {
      persisted.push({
        role: "assistant",
        content: assistantText,
        toolCalls: turnToolCalls,
      });
      toolCallsSeen.push(...turnToolCalls);
    } else {
      // Plain text reply → terminal.
      persisted.push({ role: "assistant", content: assistantText });
      buffer.push({
        role: "assistant",
        content: response.content as ContentBlockParam[],
      });
      return {
        assistantText,
        toolCalls: toolCallsSeen,
        persistedMessages: persisted,
      };
    }

    // Echo the assistant turn back into the SDK buffer verbatim so
    // tool_use ids match on the follow-up.
    buffer.push({
      role: "assistant",
      content: response.content as ContentBlockParam[],
    });

    // Dispatch every tool call sequentially. Parallel dispatch is
    // tempting but the executors share a per-user transaction context
    // and the LLM rarely emits >2 calls per round in practice.
    const toolResultBlocks: ContentBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const call: ToolCall = {
        id: block.id,
        name: block.name,
        input: block.input,
      };
      const result = await safeDispatch(toolDispatcher, call);
      const serialized = stringifyToolOutput(result.output);
      persisted.push({
        role: "tool",
        toolCallId: result.toolCallId,
        content: serialized,
      });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: result.toolCallId,
        content: serialized,
        is_error: isErrorEnvelope(result.output),
      });
    }

    // Tool results become a user-role message with tool_result blocks.
    buffer.push({ role: "user", content: toolResultBlocks });

    // Loop continues — model gets another chance to either call more
    // tools or return final text.
    if (response.stop_reason !== "tool_use") {
      // Defensive: model said it's done but still produced tool calls.
      // Treat the assistant text as final and stop.
      return {
        assistantText: lastAssistantText,
        toolCalls: toolCallsSeen,
        persistedMessages: persisted,
      };
    }
  }

  // Round-trip cap hit. Surface a sentinel so Backend can render the
  // "Bir şeyler ters gitti, tekrar dener misin?" copy. We still return
  // any tool messages already persisted so the audit log is consistent.
  const fallback = lastAssistantText || ROUNDTRIP_CAP_SENTINEL;
  persisted.push({ role: "assistant", content: ROUNDTRIP_CAP_SENTINEL });
  return {
    assistantText: fallback,
    toolCalls: toolCallsSeen,
    persistedMessages: persisted,
  };
}

// ─── helpers ────────────────────────────────────────────────────────

export const NO_KEY_SENTINEL = "__listbull_no_api_key__";
export const ROUNDTRIP_CAP_SENTINEL = "__listbull_roundtrip_cap__";

/**
 * Map our provider-neutral `ConversationMessage[]` to Anthropic's
 * `MessageParam[]`. The two shapes diverge for tool calling:
 *   - assistant + tool_calls   → assistant message with `tool_use` content blocks
 *   - tool result              → user message with `tool_result` content blocks
 *
 * Sequential `role: 'tool'` rows for the same assistant turn collapse
 * into one user message with multiple `tool_result` blocks (Anthropic's
 * required shape). The slicer guarantees their order.
 */
export function conversationToMessageParams(
  messages: ConversationMessage[],
): MessageParam[] {
  const out: MessageParam[] = [];
  let pendingResults: ContentBlockParam[] | null = null;

  const flushPendingResults = () => {
    if (pendingResults && pendingResults.length > 0) {
      out.push({ role: "user", content: pendingResults });
    }
    pendingResults = null;
  };

  for (const msg of messages) {
    if (msg.role === "tool") {
      const block: ContentBlockParam = {
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content,
      };
      if (pendingResults === null) pendingResults = [block];
      else pendingResults.push(block);
      continue;
    }

    flushPendingResults();

    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
      continue;
    }

    // assistant
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const blocks: ContentBlockParam[] = [];
      if (msg.content && msg.content.length > 0) {
        blocks.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: (tc.input ?? {}) as Record<string, unknown>,
        });
      }
      out.push({ role: "assistant", content: blocks });
    } else {
      out.push({ role: "assistant", content: msg.content });
    }
  }

  flushPendingResults();
  return out;
}

type SplitResult = {
  textParts: string[];
  toolUseBlocks: Array<{ id: string; name: string; input: unknown }>;
};

function splitContent(content: ContentBlock[] | null | undefined): SplitResult {
  const textParts: string[] = [];
  const toolUseBlocks: SplitResult["toolUseBlocks"] = [];
  // Defensive: OpenRouter occasionally returns a response with `content`
  // missing or null when proxying non-Anthropic models (notably the
  // `:online` plugin layer for Gemini/OpenAI). Treat as empty turn so the
  // caller can decide to retry or fall through with an empty assistant.
  if (!Array.isArray(content)) {
    return { textParts, toolUseBlocks };
  }
  for (const block of content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      toolUseBlocks.push({
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
    // thinking / server_tool_use / etc. — ignored for our flow.
  }
  return { textParts, toolUseBlocks };
}

/**
 * Run the dispatcher; convert thrown errors into structured tool
 * results so the LLM keeps going. A throw indicates infra trouble
 * (DB down, etc.) that we want to surface as an error envelope rather
 * than crashing the whole turn.
 */
async function safeDispatch(
  dispatch: (call: ToolCall) => Promise<ToolResult>,
  call: ToolCall,
): Promise<ToolResult> {
  try {
    return await dispatch(call);
  } catch (err) {
    return {
      toolCallId: call.id,
      output: {
        ok: false,
        error: {
          code: "internal_error",
          message:
            err instanceof Error ? err.message : "Unknown executor error",
        },
      },
    };
  }
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return JSON.stringify({
      ok: false,
      error: { code: "serialization_error", message: "Unserializable tool output" },
    });
  }
}

function isErrorEnvelope(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    "ok" in output &&
    (output as { ok: unknown }).ok === false
  );
}

/**
 * Convert a zod schema into the JSON Schema shape Anthropic expects
 * for tool input definitions. We use zod's built-in `z.toJSONSchema`
 * (zod v4); the result has `type: 'object'` at the root which matches
 * Anthropic's `Tool.InputSchema` requirement.
 *
 * Anthropic's `Tool.InputSchema` is strict on `type: 'object'` — if a
 * tool's root isn't an object, that's a contract bug (all 6 of ours are).
 */
function zodToInputSchema(
  schema: z.ZodTypeAny,
): AnthropicTool["input_schema"] {
  const json = z.toJSONSchema(schema, { target: "draft-07" }) as Record<
    string,
    unknown
  >;
  // Strip the $schema key (Anthropic ignores it; cleaner request body).
  delete json.$schema;
  // Force the root type — Anthropic requires "object" at the top level.
  return {
    ...json,
    type: "object",
  } as AnthropicTool["input_schema"];
}
