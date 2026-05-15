/**
 * Bot LLM router (Phase 17 chat-only).
 *
 * Replaces the workspace + list resolution path with a simple chat
 * lookup: `ensureChat` lazily creates the chat row + auto-adds the
 * sender to chat_members. Items, activity, reminders all scope on
 * chat_id.
 *
 * Flow:
 *   1. Resolve user (upsertUserFromTelegram).
 *   2. Determine chat type (private | group | supergroup) + ensure chat row.
 *   3. Privacy filter for groups: skip messages that don't mention the bot.
 *   4. API-key paste intercept (sk-or-v1-...) → set_chat_api_key directly,
 *      delete user's Telegram message, return.
 *   5. Resolve OpenRouter key from chat. None → reply with paste hint.
 *   6. Voice STT, forwarded, attachment paths (each transforms the user
 *      text into the LLM-visible content).
 *   7. Persist user message (redacted), call LLM, persist assistant
 *      messages, send replies.
 *
 * Webhook ack happens upstream in `/api/telegram/webhook/route.ts`;
 * this handler runs on the same request but never throws for tool
 * errors (those travel back as envelopes).
 */
import "server-only";

import type { Context } from "grammy";

import { env } from "@/lib/env";
import { ensureChat } from "@/lib/db/queries/chats";
import { getRecentMessages, insertMessages } from "@/lib/db/queries/messages";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { enforceRateLimit } from "@/lib/server/middleware/rate-limit";
import { sliceForContext } from "@/lib/ai/conversation";
import {
  NO_KEY_SENTINEL,
  ROUNDTRIP_CAP_SENTINEL,
  respond,
} from "@/lib/ai/respond";
import { decrypt } from "@/lib/server/encryption";
import { db } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createToolDispatcher } from "@/lib/server/tools/dispatcher";
import { pickLocale } from "@/lib/server/bot/i18n";
import { executeSetChatApiKey } from "@/lib/server/tools/set-chat-api-key";
import { upsertChatMember } from "@/lib/db/queries/chats";

import type {
  ChatType,
  ConversationMessage,
  NewMessage,
  ToolCall,
  User,
} from "@/lib/types";

const TG_MAX_MESSAGE_LEN = 4096;

const COPY = {
  tr: {
    noKey:
      "🔑 Bu chat'in OpenRouter API key'i tanımlı değil. Onsuz cevap veremem.\n\n📋 Adımlar (~2 dk):\n  1. openrouter.ai/keys → Sign in\n  2. $5+ credit yükle (default model ile binlerce mesaj yetiyor)\n  3. \"Create Key\" → kopyala (sk-or-v1-… ile başlar)\n\n📥 Key'i direkt buraya yapıştır → otomatik kaydederim + mesajını güvenlik için silerim. Sadece chat sahibi koyabilir.",
    keyDecryptError:
      "❗️ Chat API key'i okunamadı. Sahibi key'i tekrar koymalı.",
    transientError: "❗️ Bir şeyler ters gitti, tekrar dener misin?",
    rateLimited:
      "⏳ Saatlik mesaj limitin doldu — biraz dinlen, sonra tekrar yaz.",
    voiceUnsupported:
      "🎤 Sesli mesaj şu an desteklenmiyor — yazılı mesaj at.",
  },
  en: {
    noKey:
      "🔑 This chat's OpenRouter API key isn't set. I can't reply without one.\n\n📋 Steps (~2 min):\n  1. openrouter.ai/keys → Sign in\n  2. Add $5+ credit (covers thousands of messages on the default model)\n  3. \"Create Key\" → copy (starts with sk-or-v1-…)\n\n📥 Paste the key here → I save it automatically and delete your message for safety. Only the chat owner can set it.",
    keyDecryptError:
      "❗️ Couldn't read this chat's API key. The owner needs to set it again.",
    transientError: "❗️ Something went wrong — try again?",
    rateLimited:
      "⏳ Hourly message limit hit — take a breather, then try again.",
    voiceUnsupported:
      "🎤 Voice messages aren't supported right now — type a message.",
  },
} as const;

export type AttachmentExtract = {
  kind:
    | "photo"
    | "video"
    | "document"
    | "audio"
    | "voice"
    | "video_note";
  fileId: string;
  fileUniqueId: string;
  mimeType?: string;
  fileSize?: number;
  duration?: number;
  width?: number;
  height?: number;
  thumbnailFileId?: string;
  filename?: string;
};

function extractAttachmentFromMessage(
  message: Context["message"] & object,
): AttachmentExtract | null {
  const m = message as unknown as Record<string, unknown>;
  // Photo: array of progressive sizes; the last is the largest.
  if (Array.isArray(m.photo) && m.photo.length > 0) {
    const arr = m.photo as Array<{
      file_id: string;
      file_unique_id: string;
      file_size?: number;
      width?: number;
      height?: number;
    }>;
    const largest = arr[arr.length - 1];
    if (largest) {
      return {
        kind: "photo",
        fileId: largest.file_id,
        fileUniqueId: largest.file_unique_id,
        fileSize: largest.file_size,
        width: largest.width,
        height: largest.height,
      };
    }
  }
  for (const kind of ["video", "document", "audio", "voice", "video_note"] as const) {
    const f = m[kind] as
      | {
          file_id?: string;
          file_unique_id?: string;
          mime_type?: string;
          file_size?: number;
          duration?: number;
          width?: number;
          height?: number;
          thumb?: { file_id?: string };
          file_name?: string;
        }
      | undefined;
    if (f && typeof f === "object" && typeof f.file_id === "string") {
      return {
        kind,
        fileId: f.file_id,
        fileUniqueId: f.file_unique_id ?? "",
        mimeType: f.mime_type,
        fileSize: f.file_size,
        duration: f.duration,
        width: f.width,
        height: f.height,
        thumbnailFileId: f.thumb?.file_id,
        filename: f.file_name,
      };
    }
  }
  return null;
}

function formatAttachmentContext(att: AttachmentExtract): string {
  const parts = [`kind=${att.kind}`, `file_id=${att.fileId}`];
  if (att.fileUniqueId) parts.push(`file_unique_id=${att.fileUniqueId}`);
  if (att.mimeType) parts.push(`mime_type=${att.mimeType}`);
  if (att.fileSize !== undefined) parts.push(`file_size=${att.fileSize}`);
  if (att.duration !== undefined) parts.push(`duration=${att.duration}`);
  if (att.width !== undefined) parts.push(`width=${att.width}`);
  if (att.height !== undefined) parts.push(`height=${att.height}`);
  if (att.filename) parts.push(`filename=${att.filename}`);
  return `[ATTACHMENT_CONTEXT: ${parts.join(" ")}]`;
}

export async function handleMessage(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;

  const text = message.text ?? "";
  const caption =
    typeof (message as { caption?: unknown }).caption === "string"
      ? ((message as { caption: string }).caption as string)
      : "";

  const rawAttachment = extractAttachmentFromMessage(message);
  const isVoiceInput =
    rawAttachment !== null &&
    (rawAttachment.kind === "voice" ||
      rawAttachment.kind === "audio" ||
      rawAttachment.kind === "video_note");
  const attachment = isVoiceInput ? null : rawAttachment;
  let effectiveText = text || caption;

  // Skip slash commands (bot.command() handles them) when there's
  // no forward/attachment payload to override.
  if (
    !attachment &&
    !isVoiceInput &&
    (!effectiveText || effectiveText.startsWith("/"))
  ) {
    return;
  }

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Run /start first.");
    return;
  }

  const locale = pickLocale(user.locale);
  const copy = COPY[locale];
  const chatType = message.chat.type as ChatType;
  const chatId = message.chat.id;
  const isGroupContext = chatType === "group" || chatType === "supergroup";

  // Ensure the chat row exists + the sender is a chat member.
  await ensureChat({
    chatId,
    type: chatType,
    title:
      message.chat.type === "private"
        ? null
        : (message.chat as { title?: string }).title ?? null,
    ownerUserId: user.id,
  });
  await upsertChatMember(chatId, user.id);

  // Group privacy filter: only act on @-mentions or replies to bot.
  if (isGroupContext && !attachment) {
    const botUsername = ctx.me.username;
    const mentionsBot =
      effectiveText.includes(`@${botUsername}`) ||
      message.reply_to_message?.from?.id === ctx.me.id;
    if (!mentionsBot) return;
    effectiveText = effectiveText
      .replace(new RegExp(`@${botUsername}\\b`, "gi"), "")
      .trim();
    if (effectiveText.length === 0 && !message.reply_to_message?.text) {
      return;
    }
  }

  // Per-user hourly rate limit.
  const hourlyLimit = env.LISTBULL_PER_USER_HOURLY_MSG_LIMIT;
  if (hourlyLimit > 0) {
    const rl = await enforceRateLimit({
      scope: "bot-message",
      identifier: user.id,
      tokens: hourlyLimit,
      windowSeconds: 3600,
    });
    if (rl.limited) {
      await ctx.reply(copy.rateLimited);
      return;
    }
  }

  // ─── Pre-LLM API key paste intercept ──────────────────────────────
  // Two paths:
  //   a) User pastes the key in the chat where it'll be used → target
  //      is the current chatId.
  //   b) User replies in DM to the bot's "set up GROUP key" prompt
  //      (which carries a [ctx:set_key:<groupChatId>] marker). The
  //      key is for the group, not the DM — route it to the marked
  //      chatId. Without (b), pasting a key in DM after my_chat_member
  //      would silently save it to the DM, leaving the group unauthed.
  const KEY_RE = /sk-or-v1-[A-Za-z0-9_-]{20,}/;
  const keyMatch = effectiveText.match(KEY_RE);
  if (keyMatch) {
    let targetChatId = chatId;
    const replyText = message.reply_to_message?.text;
    if (
      message.reply_to_message?.from?.id === ctx.me.id &&
      typeof replyText === "string"
    ) {
      const m = replyText.match(/\[ctx:set_key:(-?\d+)\]/);
      if (m) {
        const parsed = Number.parseInt(m[1]!, 10);
        if (Number.isFinite(parsed)) targetChatId = parsed;
      }
    }
    const result = await executeSetChatApiKey(
      { api_key: keyMatch[0] },
      { userId: user.id, chatId: targetChatId },
    );
    if (message.chat.type === "private") {
      try {
        await ctx.api.deleteMessage(message.chat.id, message.message_id);
      } catch {
        // ignore permission/age errors
      }
    }
    if (result.ok) {
      const suffix = result.data.key_suffix;
      const groupSuffix =
        targetChatId !== chatId
          ? locale === "tr"
            ? ` (grup için)`
            : ` (for the group)`
          : "";
      await ctx.reply(
        locale === "tr"
          ? `🔑 Key kaydedildi${groupSuffix} (…${suffix}). Pasted mesajını güvenlik için sildim. ✨ Artık hazırım — yaz, başlayalım.`
          : `🔑 Key saved${groupSuffix} (…${suffix}). Deleted your pasted message for safety. ✨ I'm ready — message away.`,
      );
    } else {
      await ctx.reply(
        locale === "tr"
          ? `❗️ Key kaydedilemedi: ${result.error.message}`
          : `❗️ Couldn't save key: ${result.error.message}`,
      );
    }
    return;
  }

  // ─── Resolve OpenRouter key from chats table ──────────────────────
  let apiKey: string | null = null;
  const [chatRow] = await db
    .select({
      openrouterApiKeyEncrypted: chats.openrouterApiKeyEncrypted,
      ownerUserId: chats.ownerUserId,
      llmModel: chats.llmModel,
    })
    .from(chats)
    .where(eq(chats.chatId, chatId))
    .limit(1);
  if (chatRow?.openrouterApiKeyEncrypted) {
    try {
      apiKey = decrypt(chatRow.openrouterApiKeyEncrypted);
    } catch {
      await ctx.reply(copy.keyDecryptError);
      return;
    }
  }

  if (apiKey === null) {
    await ctx.reply(copy.noKey, {
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  // Voice STT removed in Phase 17. Voice/audio messages are treated
  // as a no-op for now (no transcription path). Re-introduce in a
  // future phase if needed.
  if (isVoiceInput) {
    await ctx.reply(copy.voiceUnsupported);
    return;
  }

  // ─── Reply-to context ─────────────────────────────────────────────
  // Group: forward who the user was replying to so the LLM has the
  // mention context. DM + group both: if the reply is to a bot
  // force-reply prompt carrying a [ctx:<action>:<itemId>] marker, hand
  // that to the LLM so it knows which item + action the message
  // pertains to (edit / deadline / reminder / attach).
  const replyTo = message.reply_to_message;
  let actionMarker: { action: string; itemId: string } | null = null;
  if (replyTo) {
    if (
      replyTo.from?.id === ctx.me.id &&
      typeof replyTo.text === "string"
    ) {
      const m = replyTo.text.match(
        /\[ctx:(edit|deadline|reminder|attach):([0-9a-f-]{36})\]/i,
      );
      if (m) {
        actionMarker = { action: m[1]!.toLowerCase(), itemId: m[2]! };
      }
    } else if (
      isGroupContext &&
      replyTo.from?.id !== ctx.me.id &&
      typeof replyTo.text === "string" &&
      replyTo.text.length > 0
    ) {
      const sender =
        replyTo.from?.username ?? replyTo.from?.first_name ?? "user";
      effectiveText = `[Replying to @${sender}: ${replyTo.text}]\n${effectiveText}`.trim();
    }
  }

  // ─── Persist user message + LLM call ──────────────────────────────
  let llmContent = effectiveText;
  let persistedContent = effectiveText;

  if (attachment) {
    const placeholder = `[${attachment.kind} sent]`;
    if (!persistedContent) persistedContent = placeholder;
    llmContent = `${effectiveText || placeholder}\n\n${formatAttachmentContext(attachment)}`;
  }

  // actionMarker runs after attachment so it can layer the directive
  // on top while preserving attachment metadata for the LLM.
  if (actionMarker) {
    const directive = buildActionDirective(actionMarker, effectiveText);
    llmContent = attachment
      ? `${directive}\n\n${formatAttachmentContext(attachment)}`
      : directive;
    if (!persistedContent) persistedContent = "(empty)";
  }

  const userMessageRow: NewMessage = {
    userId: user.id,
    chatId,
    role: "user",
    content: persistedContent,
    toolCalls: null,
    toolCallId: null,
  };

  const recent = await getRecentMessages(user.id, chatId, 30);
  const history = sliceForContext(recent);

  const messagesForLlm: ConversationMessage[] = [
    ...history,
    { role: "user", content: llmContent },
  ];

  await insertMessages([userMessageRow]);

  const dispatcher = createToolDispatcher({ userId: user.id, chatId });

  try {
    const response = await respond({
      apiKey,
      model: chatRow?.llmModel ?? user.llmModel,
      messages: messagesForLlm,
      user: {
        locale: user.locale,
        firstName: user.telegramFirstName,
        timezone: user.timezone,
      },
      chat: {
        chatId,
        title: message.chat.type === "private" ? null : (message.chat as { title?: string }).title ?? null,
        type: chatType,
        isOwner: chatRow?.ownerUserId === user.id,
      },
      toolDispatcher: dispatcher,
    });

    if (response.assistantText === NO_KEY_SENTINEL) {
      await ctx.reply(copy.noKey, {
        link_preview_options: { is_disabled: true },
      });
      return;
    }
    if (response.assistantText === ROUNDTRIP_CAP_SENTINEL) {
      await ctx.reply(copy.transientError);
      return;
    }

    const rowsToInsert: NewMessage[] = response.persistedMessages.map((m) =>
      toMessageRow(user, chatId, m),
    );
    if (rowsToInsert.length > 0) {
      await insertMessages(rowsToInsert);
    }

    if (response.assistantText.trim().length === 0) return;
    await sendChunked(ctx, response.assistantText);
  } catch (err) {
    console.error("[handle-message] LLM error", err);
    try {
      await ctx.reply(copy.transientError);
    } catch {
      // ignore
    }
  }
}

function toMessageRow(
  user: User,
  chatId: number,
  m: ConversationMessage,
): NewMessage {
  if (m.role === "user") {
    return {
      userId: user.id,
      chatId,
      role: "user",
      content: m.content,
      toolCalls: null,
      toolCallId: null,
    };
  }
  if (m.role === "assistant") {
    return {
      userId: user.id,
      chatId,
      role: "assistant",
      content: m.content,
      toolCalls: m.toolCalls ? (m.toolCalls as unknown as ToolCall[]) : null,
      toolCallId: null,
    };
  }
  return {
    userId: user.id,
    chatId,
    role: "tool",
    content: m.content,
    toolCalls: null,
    toolCallId: m.toolCallId,
  };
}

/**
 * Translate a force-reply action marker + the user's reply text into
 * a directive the LLM can act on. The LLM is already trained on the
 * tool catalog by the system prompt — it just needs to know which
 * item and which kind of update to apply.
 */
function buildActionDirective(
  marker: { action: string; itemId: string },
  userText: string,
): string {
  const trimmed = userText.trim();
  const body =
    trimmed.length > 0
      ? trimmed
      : marker.action === "attach"
        ? "(file/photo sent as attachment)"
        : "(empty reply)";
  switch (marker.action) {
    case "edit":
      return `Update item ${marker.itemId}: change its text to: ${body}. Call update_item.`;
    case "deadline":
      return `Set the deadline of item ${marker.itemId} based on this natural-language description: "${body}". Call set_deadline. If the user said "remove" or "clear", clear the deadline by passing deadline_at: null.`;
    case "reminder":
      return `Add a reminder to item ${marker.itemId} based on this natural-language description: "${body}". Call add_reminder — use offset_minutes when the user says "X before deadline", remind_at for absolute times.`;
    case "attach":
      return `User is replying with an attachment to add to item ${marker.itemId}. Their accompanying note: "${body}". Call attach_file_to_item with the attachment metadata from the latest message context.`;
    default:
      return body;
  }
}

async function sendChunked(ctx: Context, text: string): Promise<void> {
  if (text.length <= TG_MAX_MESSAGE_LEN) {
    await ctx.reply(text);
    return;
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TG_MAX_MESSAGE_LEN) {
    let cut = remaining.lastIndexOf(" ", TG_MAX_MESSAGE_LEN);
    if (cut < 1000) cut = TG_MAX_MESSAGE_LEN;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  for (const c of chunks) {
    await ctx.reply(c);
  }
}
