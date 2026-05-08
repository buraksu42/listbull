/**
 * Phase 13: speech-to-text via OpenRouter (Gemini 2.5 Flash audio).
 *
 * No new env vars — reuses the same OpenRouter API key the LLM round-
 * trip uses (BYOK chain: user → workspace → operator). The transcript
 * gets injected as a synthetic user text turn into the existing LLM
 * pipeline, so all 24 tools work the same as if the user had typed.
 *
 * Why raw `fetch` instead of the Anthropic SDK in `respond.ts`: that
 * SDK doesn't support OpenAI-style `input_audio` content blocks. We
 * speak OpenRouter's OpenAI-compat surface directly here — narrow
 * scope (one POST), no upstream client lib needed.
 *
 * Caps:
 *   - 15MB per file. Telegram voice typically ~1MB; the cap is a
 *     belt-and-braces guard against operator costs spiking on giant
 *     audio attachments. The bot CDN caps file downloads at 20MB
 *     anyway so this rejects before the download attempt fails.
 *   - Latency: empirically 1–3s for ≤30s audio; total turn (STT +
 *     LLM round-trip) lands well under Telegram's 60s webhook ack
 *     budget for the inline-await path.
 */
import "server-only";

import type { Context } from "grammy";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const STT_MODEL = "google/gemini-2.5-flash";
const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB

type Locale = "tr" | "en";

export type SttSuccess = { text: string };
export type SttError = {
  error: "too_long" | "transcribe_failed" | "download_failed" | "empty";
};
export type SttResult = SttSuccess | SttError;

/**
 * Telegram voice messages arrive as `audio/ogg` (OPUS). Audio
 * attachments and video_note audio tracks have known mime hints; we
 * map them to OpenRouter's `format` values.
 */
function pickAudioFormat(args: {
  kind: "voice" | "audio" | "video_note";
  mimeType?: string | null;
}): string {
  if (args.kind === "voice") return "ogg";
  if (args.kind === "video_note") return "mp4";
  // audio: trust mime when present
  const m = (args.mimeType ?? "").toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp4") || m.includes("m4a")) return "mp4";
  if (m.includes("flac")) return "flac";
  // Fallback. OpenRouter rejects unknown formats — better an explicit
  // error than a silent garbage transcript.
  return "ogg";
}

/**
 * Download a Telegram file via the bot API + transcribe through
 * OpenRouter's chat completions endpoint. Idempotent + side-effect
 * free: writes nothing to the DB, sends no Telegram messages.
 *
 * The caller is responsible for:
 *   - calling `ctx.replyWithChatAction("typing")` before invoking
 *     us (gives the user a "transcribing…" affordance);
 *   - persisting the transcript as the user message.
 */
export async function transcribeAudioFromTelegram(args: {
  ctx: Context;
  fileId: string;
  kind: "voice" | "audio" | "video_note";
  mimeType?: string | null;
  apiKey: string;
  locale: Locale;
  /** Used as OpenRouter X-Title metadata; defaults to 'listbull'. */
  appTitle?: string;
}): Promise<SttResult> {
  const { ctx, fileId, kind, mimeType, apiKey, locale } = args;

  let downloadUrl: string;
  let fileSize: number | null = null;
  try {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      return { error: "download_failed" };
    }
    fileSize = typeof file.file_size === "number" ? file.file_size : null;
    if (fileSize !== null && fileSize > MAX_AUDIO_BYTES) {
      return { error: "too_long" };
    }
    // grammY's `Bot` carries the resolved token; ctx.api wraps it but
    // doesn't expose the token directly. Compose the file URL by
    // reading from the bot's API root.
    const tokenSource = (ctx.api as { token?: string }).token;
    if (!tokenSource) {
      return { error: "download_failed" };
    }
    downloadUrl = `https://api.telegram.org/file/bot${tokenSource}/${file.file_path}`;
  } catch (e) {
    console.warn("[stt] getFile failed", { fileId, error: String(e) });
    return { error: "download_failed" };
  }

  let audioBuffer: Buffer;
  try {
    const resp = await fetch(downloadUrl);
    if (!resp.ok) {
      console.warn("[stt] download failed", {
        status: resp.status,
        statusText: resp.statusText,
      });
      return { error: "download_failed" };
    }
    audioBuffer = Buffer.from(await resp.arrayBuffer());
    if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
      return { error: "too_long" };
    }
  } catch (e) {
    console.warn("[stt] fetch failed", { error: String(e) });
    return { error: "download_failed" };
  }

  const base64 = audioBuffer.toString("base64");
  const format = pickAudioFormat({ kind, mimeType });
  const prompt =
    locale === "tr"
      ? "Aşağıdaki ses kaydını harfi harfine yazıya dök. Sadece transkripti döndür, açıklama veya yorum ekleme."
      : "Transcribe the following audio recording verbatim. Return only the transcript, no commentary.";

  let response: Response;
  try {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://prod.listbull.org",
        "X-Title": args.appTitle ?? "listbull",
      },
      body: JSON.stringify({
        model: STT_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: { data: base64, format },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });
  } catch (e) {
    console.warn("[stt] openrouter fetch threw", { error: String(e) });
    return { error: "transcribe_failed" };
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      /* swallow */
    }
    console.warn("[stt] openrouter returned non-2xx", {
      status: response.status,
      detail: detail.slice(0, 200),
    });
    return { error: "transcribe_failed" };
  }

  let transcript = "";
  try {
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const raw = json.choices?.[0]?.message?.content;
    if (typeof raw === "string") {
      transcript = raw.trim();
    } else if (Array.isArray(raw)) {
      // Some OpenAI-compat servers return a content array of parts.
      transcript = raw
        .map((part) => {
          if (
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof (part as { text: unknown }).text === "string"
          ) {
            return (part as { text: string }).text;
          }
          return "";
        })
        .join(" ")
        .trim();
    }
  } catch (e) {
    console.warn("[stt] response JSON parse failed", { error: String(e) });
    return { error: "transcribe_failed" };
  }

  if (!transcript) {
    return { error: "empty" };
  }

  return { text: transcript };
}
