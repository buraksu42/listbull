/**
 * Voice → text transcription via an OpenRouter audio-capable model.
 *
 * Telegram voice notes are OGG/Opus; OpenRouter's `input_audio`
 * content part accepts `ogg` directly, so no ffmpeg conversion is
 * needed. The transcript is fed back into the normal message flow as
 * if the user had typed it — the user's own conversation model still
 * does the tool routing; this module only handles speech-to-text.
 */
import "server-only";

import { env } from "@/lib/env";

const TELEGRAM_API = "https://api.telegram.org";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Multimodal model used ONLY for speech-to-text. Cheap, accepts audio
// input, strong on Turkish + English. Conversation routing is
// unaffected — it keeps using the chat's configured model.
const STT_MODEL = "google/gemini-2.5-flash";

// Telegram voice notes are tiny; cap downloads so a malformed file
// can't blow up memory.
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/** Map a Telegram attachment kind + mime type to an OpenRouter audio format. */
function audioFormat(kind: string, mimeType: string | undefined): string | null {
  const mt = (mimeType ?? "").toLowerCase();
  if (mt.includes("ogg")) return "ogg";
  if (mt.includes("mpeg") || mt.includes("mp3")) return "mp3";
  if (mt.includes("m4a") || mt.includes("mp4") || mt.includes("aac")) return "m4a";
  if (mt.includes("wav")) return "wav";
  if (mt.includes("flac")) return "flac";
  // Voice notes are always OGG/Opus even when mime is absent.
  if (kind === "voice") return "ogg";
  if (kind === "audio") return "mp3";
  // video_note (mp4 video) — no audio-only container; unsupported.
  return null;
}

/**
 * Download a Telegram voice/audio file and transcribe it. Returns the
 * transcript, or null on any failure (caller shows a friendly nudge).
 */
export async function transcribeVoice(args: {
  fileId: string;
  kind: string;
  mimeType: string | undefined;
  apiKey: string;
}): Promise<string | null> {
  const format = audioFormat(args.kind, args.mimeType);
  if (!format) return null;

  // 1. getFile → file_path
  let filePath: string;
  try {
    const res = await fetch(
      `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(args.fileId)}`,
    );
    const json = (await res.json()) as {
      ok: boolean;
      result?: { file_path?: string };
    };
    if (!json.ok || !json.result?.file_path) return null;
    filePath = json.result.file_path;
  } catch (e) {
    console.error("[voice-stt] getFile failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }

  // 2. download the audio bytes → base64
  let base64: string;
  try {
    const res = await fetch(
      `${TELEGRAM_API}/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`,
    );
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_AUDIO_BYTES) return null;
    base64 = buf.toString("base64");
  } catch (e) {
    console.error("[voice-stt] download failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }

  // 3. transcribe via OpenRouter (OpenAI-format chat completion with
  //    an input_audio content part).
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: STT_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe this voice message verbatim. The speaker is most likely talking in Turkish or English. Output ONLY the transcript text — no quotes, no translation, no commentary, no preamble.",
              },
              {
                type: "input_audio",
                input_audio: { data: base64, format },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[voice-stt] openrouter non-ok", { status: res.status });
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const transcript = content.trim();
    return transcript.length > 0 ? transcript : null;
  } catch (e) {
    console.error("[voice-stt] transcribe failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
