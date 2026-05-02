/**
 * Bot LLM router. Wired in `src/lib/server/bot/index.ts` after slash
 * command handlers (commands take priority — grammY routes them first
 * because `bot.command()` filters on the leading `/foo` and we register
 * `bot.on("message:text", handleMessage)` AFTER all `bot.command(...)`
 * calls).
 *
 * Flow:
 *   1. Resolve the calling user; require BYOK key configured.
 *   2. Persist the inbound user message.
 *   3. Load last 30 messages for (user, chat); slice via AI's
 *      sliceForContext.
 *   4. Append the new user message to the sliced history; call respond().
 *   5. Persist the assistant + tool messages produced this turn.
 *   6. Send the final assistant text back to Telegram. Chunk on word
 *      boundaries when >4096 chars.
 *
 * Phase 2 awaits the LLM inline (test scale; webhook still ack-200s
 * within Telegram's 60s budget). Phase 4 will defer via setImmediate
 * for production scale.
 */
import "server-only";

import type { Context } from "grammy";

import { getRecentMessages, insertMessages } from "@/lib/db/queries/messages";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { sliceForContext } from "@/lib/ai/conversation";
import { forwardedMessagePrompt } from "@/lib/ai/prompts/forwarded";
import {
  NO_KEY_SENTINEL,
  ROUNDTRIP_CAP_SENTINEL,
  respond,
} from "@/lib/ai/respond";
import { decrypt } from "@/lib/server/encryption";
import { createToolDispatcher } from "@/lib/server/tools/dispatcher";
import { pickLocale } from "@/lib/server/bot/i18n";

import type {
  ConversationMessage,
  NewMessage,
  ToolCall,
  User,
} from "@/lib/types";

/** Telegram caps outgoing messages at 4096 chars. */
const TG_MAX_MESSAGE_LEN = 4096;

/**
 * Hardcoded UI copy. Bot-side i18n.ts has a small dict; we extend
 * inline here rather than mutate that file (frontend conventions —
 * shared dict gets larger in Phase 4 with E1+E3 work).
 */
const COPY = {
  tr: {
    noKey:
      "AI özelliklerini kullanmak için Mini App ayarlarından OpenRouter API anahtarınızı ekleyin.",
    keyDecryptError:
      "API anahtarınız okunamadı. Mini App ayarlarından yeniden ekleyin.",
    transientError: "Bir şeyler ters gitti, tekrar dener misin?",
    forwardedNoText:
      "İletilen mesajda metin bulamadım — sadece metinli mesajlardan madde çıkarabilirim.",
  },
  en: {
    noKey:
      "Add your OpenRouter API key in Mini App settings to use AI features.",
    keyDecryptError:
      "Couldn't read your API key. Re-enter it in Mini App settings.",
    transientError: "Something went wrong — try again?",
    forwardedNoText:
      "I didn't find any text in the forwarded message — I can only extract items from messages with text.",
  },
} as const;

/**
 * Phase 4 / A3: pull a human-readable sender label out of the grammY
 * `forward_origin` union. The four documented variants are
 *   - user (real Telegram user)        → first_name
 *   - hidden_user (privacy-protected)  → sender_user_name
 *   - chat (group)                     → chat title
 *   - channel                          → chat title
 * We only need a display label; nothing is persisted to `items.text`.
 */
function readForwardOrigin(message: unknown): {
  forwardedFrom: string;
} | null {
  if (!message || typeof message !== "object") return null;
  const fo = (message as { forward_origin?: unknown }).forward_origin;
  if (!fo || typeof fo !== "object") return null;
  const origin = fo as Record<string, unknown>;
  switch (origin.type) {
    case "user": {
      const u = origin.sender_user as { first_name?: string } | undefined;
      return { forwardedFrom: u?.first_name ?? "Unknown sender" };
    }
    case "hidden_user": {
      const name = origin.sender_user_name;
      return {
        forwardedFrom: typeof name === "string" ? name : "Unknown sender",
      };
    }
    case "chat": {
      const c = origin.sender_chat as { title?: string } | undefined;
      return { forwardedFrom: c?.title ?? "Unknown chat" };
    }
    case "channel": {
      const c = origin.chat as { title?: string } | undefined;
      return { forwardedFrom: c?.title ?? "Unknown channel" };
    }
    default:
      return null;
  }
}

export async function handleMessage(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;

  const text = message.text ?? "";
  // Forwarded messages take a different path: the LLM sees a single-purpose
  // extraction system prompt + bounded round-trip cap (Inv-16). We branch
  // BEFORE the slash-command guard so a forwarded `/something` body is
  // still treated as forwarded text (slash commands are the message
  // sender's authored text only, never a forward).
  const forward = readForwardOrigin(message);

  // Slash commands are handled by `bot.command()` registrations; defensive
  // guard for empty text. Forwards skip this guard — forwarded text may
  // legitimately start with `/`.
  if (!forward && (!text || text.startsWith("/"))) {
    return;
  }

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    // No /start has been run yet.
    await ctx.reply("Run /start first.");
    return;
  }

  const locale = pickLocale(user.locale);
  const copy = COPY[locale];
  const chatId = message.chat.id;

  // BYOK gate — fast path, no DB write if key is missing. Applies to BOTH
  // the forwarded branch and the conversational branch.
  if (!user.openrouterApiKeyEncrypted) {
    await ctx.reply(copy.noKey);
    return;
  }

  let apiKey: string;
  try {
    apiKey = decrypt(user.openrouterApiKeyEncrypted);
  } catch {
    // Key blob is unreadable — most likely ENV_KEY rotated.
    await ctx.reply(copy.keyDecryptError);
    return;
  }

  if (forward) {
    if (!text) {
      // Photo / sticker forwards have no `.text`. Phase 4 only handles
      // text forwards; reply with a clarifier.
      await ctx.reply(copy.forwardedNoText);
      return;
    }
    await handleForwardedMessage({
      ctx,
      user,
      apiKey,
      forwardedFrom: forward.forwardedFrom,
      forwardedText: text,
      copy,
      chatId,
    });
    return;
  }

  // Persist the inbound user message immediately. This way `/reset`
  // and audit log have a stable record even if the LLM call fails.
  const userMessageRow: NewMessage = {
    userId: user.id,
    chatId,
    role: "user",
    content: text,
    toolCalls: null,
    toolCallId: null,
  };

  // Load history (newest first) and slice.
  const recent = await getRecentMessages(user.id, chatId, 30);
  const history = sliceForContext(recent);

  // Append the new user turn to the sliced history before calling LLM.
  const messagesForLlm: ConversationMessage[] = [
    ...history,
    { role: "user", content: text },
  ];

  // Persist user message + invoke LLM.
  await insertMessages([userMessageRow]);

  let assistantText = "";
  let persisted: ConversationMessage[] = [];
  let toolCalls: ToolCall[] = [];

  try {
    const result = await respond({
      messages: messagesForLlm,
      user: {
        locale: user.locale,
        firstName: user.telegramFirstName,
        timezone: user.timezone,
      },
      apiKey,
      model: user.llmModel,
      toolDispatcher: createToolDispatcher({ userId: user.id }),
    });
    assistantText = result.assistantText;
    persisted = result.persistedMessages;
    toolCalls = result.toolCalls;
  } catch (error) {
    console.error("[bot/handle-message] respond() threw", error);
    await ctx.reply(copy.transientError);
    return;
  }

  // Sentinel handling — surface user-friendly copy in user's locale.
  let userFacingText = assistantText;
  if (assistantText === NO_KEY_SENTINEL) userFacingText = copy.noKey;
  if (assistantText === ROUNDTRIP_CAP_SENTINEL)
    userFacingText = copy.transientError;

  // Persist assistant + tool messages produced this turn (batch insert
  // via the shared helper — chronological order preserved by `persisted`).
  if (persisted.length > 0) {
    const rowsToInsert: NewMessage[] = persisted.map((m) =>
      conversationMessageToRow(m, user.id, chatId),
    );
    await insertMessages(rowsToInsert);
  }

  // Reply via Telegram. Phase 2: plain text (no parse_mode) to avoid
  // MarkdownV2 escape edge cases; the system prompt explicitly tells
  // the model to avoid markdown.
  await sendChunked(ctx, userFacingText);

  // Telemetry hook (no-op for now): toolCalls is the per-turn dispatch
  // log. Sentry breadcrumb in Phase 4.
  void toolCalls;
}

function conversationMessageToRow(
  msg: ConversationMessage,
  userId: string,
  chatId: number,
): NewMessage {
  switch (msg.role) {
    case "user":
      return {
        userId,
        chatId,
        role: "user",
        content: msg.content,
        toolCalls: null,
        toolCallId: null,
      };
    case "assistant":
      return {
        userId,
        chatId,
        role: "assistant",
        content: msg.content,
        toolCalls:
          msg.toolCalls && msg.toolCalls.length > 0
            ? (msg.toolCalls as unknown as object)
            : null,
        toolCallId: null,
      };
    case "tool":
      return {
        userId,
        chatId,
        role: "tool",
        content: msg.content,
        toolCalls: null,
        toolCallId: msg.toolCallId,
      };
  }
}

/**
 * Chunk on word boundaries when text exceeds Telegram's 4096-char cap.
 * Sends sequentially so messages arrive in order.
 */
async function sendChunked(ctx: Context, text: string): Promise<void> {
  if (text.length <= TG_MAX_MESSAGE_LEN) {
    await ctx.reply(text);
    return;
  }

  const chunks = splitOnWordBoundary(text, TG_MAX_MESSAGE_LEN);
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

/**
 * A3 — forwarded-message extraction path. The forwarded prompt
 * (`src/lib/ai/prompts/forwarded.ts`) is single-purpose: extract action
 * items → emit one `create_item` per item → reply with a brief
 * confirmation. We embed the forwarded prompt's instruction body INSIDE
 * the synthesized user turn (rather than swapping `respond()`'s system
 * prompt — that's the AI-agent's contract surface and out of Backend
 * scope) and call `respond()` exactly once with NO conversation history.
 *
 * Inv-16:
 *   - The forwarded prompt instructs the model "Emit all create_item
 *     calls in a SINGLE turn (one round-trip)." The standard 5-round
 *     cap in respond.ts still applies as a defense-in-depth ceiling.
 *   - The prompt enforces ≤20 items per forward and head-truncates the
 *     forwarded text at 6_000 chars before injection.
 *
 * Persistence: a synthesized user message (`[forwarded from <X>] <text>`)
 * is written to `messages` so `/reset` and the audit log have a stable
 * record of the forward, even though the LLM call may not see history.
 */
async function handleForwardedMessage(args: {
  ctx: Context;
  user: User;
  apiKey: string;
  forwardedFrom: string;
  forwardedText: string;
  copy: (typeof COPY)[keyof typeof COPY];
  chatId: number;
}): Promise<void> {
  const { ctx, user, apiKey, forwardedFrom, forwardedText, copy, chatId } =
    args;

  // Persist the synthesized user message immediately. The LLM call below
  // intentionally does NOT include history (forwarded messages are
  // single-turn extraction tasks; conversational context would dilute
  // the prompt's "extract → tool calls → reply" instructions).
  const synthesizedContent = `[forwarded from ${forwardedFrom}] ${forwardedText}`;
  const userMessageRow: NewMessage = {
    userId: user.id,
    chatId,
    role: "user",
    content: synthesizedContent,
    toolCalls: null,
    toolCallId: null,
  };
  await insertMessages([userMessageRow]);

  // Build the forwarded-prompt body. The prompt template is system-
  // prompt-shaped and includes the forwarded text inline. We pass it as
  // the (only) user-turn content; respond.ts's system.v3 still applies
  // but the user-turn instructions dominate this single-purpose task.
  const promptBody = forwardedMessagePrompt({
    userLocale: user.locale,
    userFirstName: user.telegramFirstName,
    userTimezone: user.timezone,
    forwardedFrom,
    forwardedText,
  });

  let assistantText = "";
  let persisted: ConversationMessage[] = [];

  try {
    const result = await respond({
      messages: [{ role: "user", content: promptBody }],
      user: {
        locale: user.locale,
        firstName: user.telegramFirstName,
        timezone: user.timezone,
      },
      apiKey,
      model: user.llmModel,
      toolDispatcher: createToolDispatcher({ userId: user.id }),
    });
    assistantText = result.assistantText;
    persisted = result.persistedMessages;
  } catch (error) {
    console.error("[bot/handle-message] forwarded respond() threw", error);
    await ctx.reply(copy.transientError);
    return;
  }

  let userFacingText = assistantText;
  if (assistantText === NO_KEY_SENTINEL) userFacingText = copy.noKey;
  if (assistantText === ROUNDTRIP_CAP_SENTINEL)
    userFacingText = copy.transientError;

  if (persisted.length > 0) {
    const rowsToInsert: NewMessage[] = persisted.map((m) =>
      conversationMessageToRow(m, user.id, chatId),
    );
    await insertMessages(rowsToInsert);
  }

  await sendChunked(ctx, userFacingText);
}

export function splitOnWordBoundary(text: string, maxLen: number): string[] {
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    // Look for the last whitespace within the cap window.
    const slice = remaining.slice(0, maxLen);
    const lastSpace = Math.max(
      slice.lastIndexOf(" "),
      slice.lastIndexOf("\n"),
    );
    const cut = lastSpace > Math.floor(maxLen * 0.5) ? lastSpace : maxLen;
    out.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) out.push(remaining);
  return out;
}
