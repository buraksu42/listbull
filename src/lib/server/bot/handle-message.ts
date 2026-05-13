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

import { env } from "@/lib/env";
import { getRecentMessages, insertMessages } from "@/lib/db/queries/messages";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import {
  getWorkspaceLlmModel,
  getWorkspaceMembership,
  getWorkspaceOrgKeyEncrypted,
  listUserWorkspacesWithKey,
  listWorkspacesForUser,
  resolveActiveWorkspaceId,
} from "@/lib/db/queries/workspaces";
import { enforceRateLimit } from "@/lib/server/middleware/rate-limit";
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
import { transcribeAudioFromTelegram } from "@/lib/server/bot/stt";

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
      "Bu workspace'in sahibinin OpenRouter API key tanımlaması gerek. Mini App → Workspace ayarları → Workspace API key.",
    keyDecryptError:
      "Workspace API key'i okunamadı. Workspace sahibi key'i tekrar tanımlamalı.",
    transientError: "Bir şeyler ters gitti, tekrar dener misin?",
    forwardedNoText:
      "İletilen mesajda metin bulamadım — sadece metinli mesajlardan madde çıkarabilirim.",
    rateLimited:
      "Çok fazla mesaj — biraz yavaşla. Saatlik limitin doldu, biraz sonra tekrar dene.",
    transcribeFailed: "Sesini yazıya çeviremedim, tekrar dener misin?",
    audioTooLong:
      "Ses kaydı çok uzun (15 MB üstü). Daha kısa bir kayıt gönder.",
    audioEmpty: "Ses kaydında konuşma duyamadım, tekrar dener misin?",
  },
  en: {
    noKey:
      "Your workspace owner needs to set the OpenRouter API key. Open the Mini App → Workspace settings → Workspace API key.",
    keyDecryptError:
      "Couldn't read the workspace API key. The workspace owner needs to set it again.",
    transientError: "Something went wrong — try again?",
    forwardedNoText:
      "I didn't find any text in the forwarded message — I can only extract items from messages with text.",
    rateLimited:
      "Too many messages — slow down. Your hourly limit is exhausted; try again shortly.",
    transcribeFailed: "I couldn't transcribe that audio — try again?",
    audioTooLong: "That audio is too large (over 15 MB). Send a shorter clip.",
    audioEmpty: "I didn't hear any speech in that audio — try again?",
  },
} as const;

/**
 * Phase 14b: extract attachment metadata from a Telegram message.
 *
 * Returns `null` for messages without any attachment, otherwise the
 * shape the LLM consumes via the `[ATTACHMENT_CONTEXT: ...]` overlay
 * AND the `attach_file_to_item` tool consumes verbatim.
 *
 * Photos: largest size variant wins (Telegram returns an array of
 * progressively larger thumbnails; the last entry is the original).
 * Videos / documents / audio: the single object on `message.<kind>`.
 * Voice / video_note: same shape; treated as audio for transcription
 * downstream (Phase 13).
 */
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

export function extractAttachmentFromMessage(
  message: unknown,
): AttachmentExtract | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;

  // Photos: pick the largest variant (last in the array per Telegram).
  if (Array.isArray(m.photo) && m.photo.length > 0) {
    const largest = m.photo[m.photo.length - 1] as Record<string, unknown>;
    if (typeof largest.file_id === "string") {
      return {
        kind: "photo",
        fileId: largest.file_id,
        fileUniqueId:
          typeof largest.file_unique_id === "string"
            ? largest.file_unique_id
            : "",
        fileSize:
          typeof largest.file_size === "number" ? largest.file_size : undefined,
        width: typeof largest.width === "number" ? largest.width : undefined,
        height: typeof largest.height === "number" ? largest.height : undefined,
      };
    }
  }

  const oneOf = (key: string): Record<string, unknown> | null => {
    const v = m[key];
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  };

  const video = oneOf("video");
  if (video && typeof video.file_id === "string") {
    const thumb = oneOf("video.thumb") ?? (video.thumb as Record<string, unknown> | undefined);
    return {
      kind: "video",
      fileId: video.file_id,
      fileUniqueId:
        typeof video.file_unique_id === "string" ? video.file_unique_id : "",
      mimeType: typeof video.mime_type === "string" ? video.mime_type : undefined,
      fileSize: typeof video.file_size === "number" ? video.file_size : undefined,
      duration:
        typeof video.duration === "number" ? video.duration : undefined,
      width: typeof video.width === "number" ? video.width : undefined,
      height: typeof video.height === "number" ? video.height : undefined,
      thumbnailFileId:
        thumb && typeof thumb.file_id === "string" ? thumb.file_id : undefined,
      filename:
        typeof video.file_name === "string" ? video.file_name : undefined,
    };
  }

  const doc = oneOf("document");
  if (doc && typeof doc.file_id === "string") {
    const thumb = doc.thumb as Record<string, unknown> | undefined;
    return {
      kind: "document",
      fileId: doc.file_id,
      fileUniqueId:
        typeof doc.file_unique_id === "string" ? doc.file_unique_id : "",
      mimeType: typeof doc.mime_type === "string" ? doc.mime_type : undefined,
      fileSize: typeof doc.file_size === "number" ? doc.file_size : undefined,
      thumbnailFileId:
        thumb && typeof thumb.file_id === "string" ? thumb.file_id : undefined,
      filename: typeof doc.file_name === "string" ? doc.file_name : undefined,
    };
  }

  const audio = oneOf("audio");
  if (audio && typeof audio.file_id === "string") {
    return {
      kind: "audio",
      fileId: audio.file_id,
      fileUniqueId:
        typeof audio.file_unique_id === "string" ? audio.file_unique_id : "",
      mimeType: typeof audio.mime_type === "string" ? audio.mime_type : undefined,
      fileSize: typeof audio.file_size === "number" ? audio.file_size : undefined,
      duration:
        typeof audio.duration === "number" ? audio.duration : undefined,
      filename: typeof audio.file_name === "string" ? audio.file_name : undefined,
    };
  }

  const voice = oneOf("voice");
  if (voice && typeof voice.file_id === "string") {
    return {
      kind: "voice",
      fileId: voice.file_id,
      fileUniqueId:
        typeof voice.file_unique_id === "string" ? voice.file_unique_id : "",
      mimeType: typeof voice.mime_type === "string" ? voice.mime_type : undefined,
      fileSize: typeof voice.file_size === "number" ? voice.file_size : undefined,
      duration:
        typeof voice.duration === "number" ? voice.duration : undefined,
    };
  }

  const note = oneOf("video_note");
  if (note && typeof note.file_id === "string") {
    return {
      kind: "video_note",
      fileId: note.file_id,
      fileUniqueId:
        typeof note.file_unique_id === "string" ? note.file_unique_id : "",
      fileSize: typeof note.file_size === "number" ? note.file_size : undefined,
      duration:
        typeof note.duration === "number" ? note.duration : undefined,
    };
  }

  return null;
}

/** Localized fallback when an attachment came in without text/caption. */
function labelKindTr(kind: AttachmentExtract["kind"]): string {
  switch (kind) {
    case "photo":
      return "Fotoğraf";
    case "video":
      return "Video";
    case "document":
      return "Belge";
    case "audio":
      return "Ses dosyası";
    case "voice":
      return "Sesli mesaj";
    case "video_note":
      return "Video notu";
  }
}

/**
 * Format an `AttachmentExtract` into the system overlay tag the LLM
 * sees on the same user turn. The LLM is instructed (tool description)
 * to pull `file_id` and metadata from this tag verbatim before
 * invoking `attach_file_to_item` — never fabricated.
 */
export function formatAttachmentContext(att: AttachmentExtract): string {
  const parts: string[] = [
    `kind=${att.kind}`,
    `file_id=${att.fileId}`,
  ];
  if (att.fileUniqueId) parts.push(`file_unique_id=${att.fileUniqueId}`);
  if (att.mimeType) parts.push(`mime_type=${att.mimeType}`);
  if (att.fileSize !== undefined) parts.push(`file_size=${att.fileSize}`);
  if (att.duration !== undefined) parts.push(`duration=${att.duration}`);
  if (att.width !== undefined) parts.push(`width=${att.width}`);
  if (att.height !== undefined) parts.push(`height=${att.height}`);
  if (att.thumbnailFileId)
    parts.push(`thumbnail_file_id=${att.thumbnailFileId}`);
  if (att.filename) parts.push(`filename=${att.filename}`);
  return `[ATTACHMENT_CONTEXT: ${parts.join(" ")}]`;
}

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
  const caption =
    typeof (message as { caption?: unknown }).caption === "string"
      ? ((message as { caption: string }).caption as string)
      : "";
  // Phase 14b: photos / videos / documents / audio / voice / video_note
  // arrive without `.text`. Caption (if any) is the user's intent.
  const rawAttachment = extractAttachmentFromMessage(message);
  // Phase 13: voice / audio / video_note are INPUT mode (the user
  // speaking instead of typing) — we transcribe and feed the text
  // through the existing LLM pipeline. They DO NOT create attachment
  // rows. Photo / video / document keep the Phase 14b attachment path.
  const isVoiceInput =
    rawAttachment !== null &&
    (rawAttachment.kind === "voice" ||
      rawAttachment.kind === "audio" ||
      rawAttachment.kind === "video_note");
  // `let` so the voice branch below can override after STT.
  let attachment = isVoiceInput ? null : rawAttachment;
  // Forwarded messages take a different path: the LLM sees a single-purpose
  // extraction system prompt + bounded round-trip cap (Inv-16). We branch
  // BEFORE the slash-command guard so a forwarded `/something` body is
  // still treated as forwarded text (slash commands are the message
  // sender's authored text only, never a forward).
  const forward = readForwardOrigin(message);

  // Effective user text: prefer `text`, then `caption` for media-only
  // messages. When neither is present BUT an attachment exists, the
  // LLM gets a stand-in placeholder so it can ask "hangi maddeye?".
  // Voice input replaces this after STT lands below.
  let effectiveText = text || caption;

  // Slash commands are handled by `bot.command()` registrations; defensive
  // guard for empty input. Skip this guard for: (a) forwards, (b) any
  // message carrying a photo/video/document attachment (we want to
  // route to the LLM with the attachment context overlay even if the
  // caption is empty), (c) voice/audio/video_note (Phase 13 — STT path
  // produces text from the audio).
  if (
    !forward &&
    !attachment &&
    !isVoiceInput &&
    (!effectiveText || effectiveText.startsWith("/"))
  ) {
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

  // Phase 10 per-user hourly rate limit. Activated when
  // LISTBULL_PER_USER_HOURLY_MSG_LIMIT > 0; disabled at 0 (default).
  // Backed by Upstash when configured; in-memory fallback otherwise.
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

  // OpenRouter API key resolution: workspace org-key is the ONLY path.
  // The workspace owner sets it in Mini App → Workspace settings →
  // Workspace API key. Every member of the workspace uses it. Per-user
  // BYOK and env-key operator fallback were both removed to collapse
  // the key model to one decision: "whose key funds this workspace?"
  const workspaceId = await resolveActiveWorkspaceId(user.id);

  let apiKey: string | null = null;
  const orgKeyEnc = await getWorkspaceOrgKeyEncrypted(workspaceId);
  if (orgKeyEnc) {
    try {
      apiKey = decrypt(orgKeyEnc);
    } catch {
      // Encrypted blob unreadable — most likely ENV_KEY rotated.
      // Surface a distinct copy so the workspace admin knows to rotate
      // rather than thinking they never set the key.
      console.warn(
        "[handle-message] workspace org-key decrypt failed",
        { workspaceId },
      );
      await ctx.reply(copy.keyDecryptError);
      return;
    }
  }

  if (apiKey === null) {
    // Context-aware noKey copy: owners get a "set it yourself" CTA;
    // members get a "your owner needs to set it" hint, plus a
    // "or switch to <X>" suggestion when another workspace they
    // belong to does have a key set.
    const membership = await getWorkspaceMembership(user.id, workspaceId);
    const otherWithKey = await listUserWorkspacesWithKey(user.id, workspaceId);
    const isOwner = membership?.role === "owner";

    const lines: string[] = [];
    if (isOwner) {
      lines.push(
        locale === "tr"
          ? "Bu workspace'in sahibisin ama OpenRouter API key tanımlı değil. Onsuz AI cevap veremem."
          : "You own this workspace but no OpenRouter API key is set. I can't reply without one.",
      );
      lines.push("");
      lines.push(
        locale === "tr"
          ? "🔑 OpenRouter ne?"
          : "🔑 What's OpenRouter?",
      );
      lines.push(
        locale === "tr"
          ? "listbull, Claude / GPT / Gemini gibi modellere OpenRouter üzerinden ulaşır. Sen kendi key'ini koyarsın, sadece kendi kullandığın kadar ödersin — listbull seninle model sağlayıcı arasında durmaz, kullanım datası bize gelmez."
          : "listbull reaches Claude / GPT / Gemini through OpenRouter. You set your own key, you pay only for what you use — listbull doesn't sit between you and the model provider, no usage telemetry comes to us.",
      );
      lines.push("");
      lines.push(
        locale === "tr"
          ? "📋 Key nasıl alınır (~3 dk)"
          : "📋 How to get a key (~3 min)",
      );
      lines.push(
        locale === "tr"
          ? "  1. openrouter.ai/keys → Sign in (Google / GitHub yeter)"
          : "  1. openrouter.ai/keys → Sign in (Google / GitHub work)",
      );
      lines.push(
        locale === "tr"
          ? "  2. Settings → Credits → min $5 yükle (default model claude-haiku-4.5 ile ~5000 mesaj)"
          : "  2. Settings → Credits → add at least $5 (≈5,000 messages on the default claude-haiku-4.5 model)",
      );
      lines.push(
        locale === "tr"
          ? "  3. Keys → 'Create Key' → kopyala (sk-or-v1-… ile başlar)"
          : "  3. Keys → 'Create Key' → copy (starts with sk-or-v1-…)",
      );
      lines.push("");
      lines.push(
        locale === "tr"
          ? "📥 Nereye yapıştırırım"
          : "📥 Where to paste it",
      );
      lines.push(
        locale === "tr"
          ? "Mini App'i aç (alt sağdaki Open App butonu) → Workspace ayarları → Workspace API key → yapıştır → Kaydet. Key sunucuda AES-256-GCM ile şifrelenir; bir daha plaintext görünmez. Bu workspace'in tüm üyeleri bu key'i kullanır (sen taşırsın)."
          : "Open Mini App (Open App button bottom-right) → Workspace settings → Workspace API key → paste → Save. The key is AES-256-GCM encrypted at rest; you'll never see it plaintext again. Every member of this workspace uses this key (you bear the cost).",
      );
      lines.push("");
      lines.push(
        locale === "tr"
          ? "💡 İpucu: Settings → Models'tan farklı bir default model seçebilirsin (Claude Sonnet 4 daha akıllı, biraz pahalı; Haiku 4.5 ucuz + hızlı; Gemini 2.5 Flash en ucuz)."
          : "💡 Tip: Settings → Models lets you pick a different default (Claude Sonnet 4 smarter but pricier; Haiku 4.5 cheap + fast; Gemini 2.5 Flash cheapest).",
      );
    } else {
      lines.push(
        locale === "tr"
          ? "Bu workspace'in sahibinin OpenRouter API key tanımlaması gerek. Sen üyesin, key'i sen koyamazsın."
          : "This workspace's owner needs to set the OpenRouter API key. You're a member, you can't set it.",
      );
      lines.push("");
      lines.push(
        locale === "tr"
          ? "Owner'a şu adımları ilet: openrouter.ai/keys → key al ($5+ credit) → Mini App → Workspace ayarları → Workspace API key → yapıştır."
          : "Pass these steps to the owner: openrouter.ai/keys → get a key ($5+ credit) → Mini App → Workspace settings → Workspace API key → paste.",
      );
    }

    if (otherWithKey.length > 0) {
      lines.push("");
      lines.push(
        locale === "tr"
          ? "🔄 Veya key'i tanımlı başka bir workspace'ine geç:"
          : "🔄 Or switch to a workspace where a key is already set:",
      );
      for (const w of otherWithKey) {
        lines.push(
          locale === "tr"
            ? `  • "${w.name}" workspace'ine geç`
            : `  • switch to "${w.name}"`,
        );
      }
    }

    await ctx.reply(lines.join("\n"), {
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  // Phase 13: voice / audio / video_note → STT, then continue through
  // the regular text path with the transcript as the user message.
  // We drop the file_id from `attachment` so the Phase 14b attachment
  // overlay path doesn't fire — voice is INPUT, not file storage.
  if (isVoiceInput && rawAttachment) {
    try {
      await ctx.replyWithChatAction("typing");
    } catch {
      // Best-effort UI affordance; never blocks STT.
    }
    const stt = await transcribeAudioFromTelegram({
      ctx,
      fileId: rawAttachment.fileId,
      kind: rawAttachment.kind as "voice" | "audio" | "video_note",
      mimeType: rawAttachment.mimeType ?? null,
      apiKey,
      locale,
      appTitle: "listbull",
    });
    if ("error" in stt) {
      const errCopy =
        stt.error === "too_long"
          ? copy.audioTooLong
          : stt.error === "empty"
            ? copy.audioEmpty
            : copy.transcribeFailed;
      await ctx.reply(errCopy);
      return;
    }
    // Transcribed text becomes the user turn. The 🎤 marker is
    // persisted to messages.content so /reset history makes the
    // voice origin recognizable without a new column.
    effectiveText = `🎤 ${stt.text}`;
    attachment = null;
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

  // Phase 14b: when an attachment came in, the user-visible text we
  // persist is the caption (or a generic placeholder) — clean for
  // history. The LLM input gets an extra system-overlay tag so the
  // model has the file_id to call `attach_file_to_item` with.
  let llmContent = effectiveText;
  let persistedContent = effectiveText;
  if (attachment) {
    const placeholder =
      locale === "tr"
        ? `[${labelKindTr(attachment.kind)} gönderildi]`
        : `[${attachment.kind} sent]`;
    if (!persistedContent) persistedContent = placeholder;
    const overlay = formatAttachmentContext(attachment);
    llmContent = `${effectiveText || placeholder}\n\n${overlay}`;
  }

  // Persist the inbound user message immediately. This way `/reset`
  // and audit log have a stable record even if the LLM call fails.
  const userMessageRow: NewMessage = {
    userId: user.id,
    chatId,
    role: "user",
    content: persistedContent,
    toolCalls: null,
    toolCallId: null,
  };

  // Load history (newest first) and slice.
  const recent = await getRecentMessages(user.id, chatId, 30);
  const history = sliceForContext(recent);

  // Append the new user turn to the sliced history before calling LLM.
  const messagesForLlm: ConversationMessage[] = [
    ...history,
    { role: "user", content: llmContent },
  ];

  // Persist user message + invoke LLM.
  await insertMessages([userMessageRow]);

  // workspaceId already resolved above (BYOK chain); reuse it for
  // executor ctx + workspace prompt. Phase 5 adds a bot-aware overlay
  // (incoming bot ID overrides users.active_workspace_id when the bot
  // is workspace-bound) — for default platform bot serves all
  // workspaces, so users.active_workspace_id is the only signal.

  // Workspace summary for the v4 system prompt — gives the LLM
  // awareness of every workspace the user belongs to (so it can
  // suggest \`switch_workspace\` when context implies another one).
  const workspaceSummary = await listWorkspacesForUser(user.id);
  // Active workspace's model — owner-controlled, every member uses
  // the same one (per-user llm_model was retired in 0020).
  const workspaceModel = await getWorkspaceLlmModel(workspaceId);

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
      workspaces: workspaceSummary.map((w) => ({
        id: w.id,
        name: w.name,
        role: w.role,
        isPersonal: w.isPersonal,
        isActive: w.isActive,
      })),
      apiKey,
      model: workspaceModel,
      toolDispatcher: createToolDispatcher({ userId: user.id, workspaceId }),
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
  // Empty-string guard. respond() can land here when the model returns
  // no content blocks at all (defensive splitContent path) — Telegram
  // 400s on empty sendMessage bodies, so substitute the transient copy.
  if (!userFacingText.trim()) {
    console.warn(
      "[bot/handle-message] empty assistantText from respond()",
      { toolCalls: toolCalls.length, persisted: persisted.length },
    );
    userFacingText = copy.transientError;
  }

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
  const stripped = stripMarkdownForTelegram(text);
  if (stripped.length <= TG_MAX_MESSAGE_LEN) {
    await ctx.reply(stripped);
    return;
  }

  const chunks = splitOnWordBoundary(stripped, TG_MAX_MESSAGE_LEN);
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

/**
 * LLM (Claude) habitually emits GitHub-flavored markdown (`**bold**`,
 * `*italic*`, `__under__`, `[link](url)`, etc.). Telegram has its own
 * markdown variants but each requires a `parse_mode` and strict
 * escaping of reserved chars (we send plain text intentionally). So
 * we strip the most common formatting markers before sending — keeps
 * the prose readable and avoids leaking `**` into chat.
 *
 * Strips:
 *   `**bold**`  → `bold`
 *   `__bold__`  → `bold`
 *   `*italic*`  → `italic`   (only when preceded by start/whitespace)
 *   `_italic_`  → `italic`   (only when preceded by start/whitespace)
 *   `[text](u)` → `text (u)` (preserves URL inline)
 *   `` `code` `` → `code`
 */
function stripMarkdownForTelegram(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|\s)_([^_\n]+)_/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
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
  const {
    ctx,
    user,
    apiKey,
    forwardedFrom,
    forwardedText,
    copy,
    chatId,
  } = args;

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

  // Same workspace resolution as the regular text path — forwarded
  // messages target the user's currently-active workspace.
  const workspaceId = await resolveActiveWorkspaceId(user.id);
  const workspaceSummary = await listWorkspacesForUser(user.id);
  const workspaceModel = await getWorkspaceLlmModel(workspaceId);

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
      workspaces: workspaceSummary.map((w) => ({
        id: w.id,
        name: w.name,
        role: w.role,
        isPersonal: w.isPersonal,
        isActive: w.isActive,
      })),
      apiKey,
      model: workspaceModel,
      toolDispatcher: createToolDispatcher({ userId: user.id, workspaceId }),
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
