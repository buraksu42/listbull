import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import type { Update } from "grammy/types";
import { NextResponse } from "next/server";

import { getBot } from "@/lib/server/bot";
import { env } from "@/lib/env";
import {
  enforceRateLimit,
  markUpdateSeen,
} from "@/lib/server/middleware/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";
// 1 MiB. Telegram update payloads are well under 100 KB; a 1 MiB
// ceiling stops a multi-megabyte body from blocking the request
// pipeline if an attacker pushes garbage at the webhook URL.
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Constant-time string comparison. Returns false fast if lengths
 * differ — without this, `String.prototype.charAt` style timing
 * leaks could narrow the secret one byte at a time.
 */
function secretsEqual(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function pickClientIp(request: Request): string {
  // Behind Traefik / Cloudflare — pick the leftmost forwarded IP.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export async function POST(request: Request) {
  // Per-IP rate limit FIRST — both legit Telegram bursts and bad-
  // secret floods stay below 600/min/IP. Telegram delivers to a small
  // set of IPs, so a single tenant is well under this ceiling. If
  // Upstash isn't configured this is a no-op (no spurious blocks).
  const ip = pickClientIp(request);
  const rl = await enforceRateLimit({
    scope: "telegram-webhook-ip",
    identifier: ip,
    tokens: 600,
    windowSeconds: 60,
  });
  if (rl.limited) {
    return NextResponse.json(
      { ok: false, error: { code: "rate_limited" } },
      { status: 429 },
    );
  }

  const provided = request.headers.get(SECRET_HEADER) ?? "";
  if (!secretsEqual(provided, env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Invalid webhook secret" } },
      { status: 401 },
    );
  }

  // Size-cap before parsing. Content-Length is advisory but cheap to
  // check; legit Telegram updates send it.
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const n = Number.parseInt(contentLength, 10);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "payload_too_large", message: "Webhook body too large" },
        },
        { status: 413 },
      );
    }
  }

  let update: Update;
  try {
    update = (await request.json()) as Update;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  // Replay protection: even if an attacker captures secret + body
  // and replays, the second delivery acks without side effects.
  // Telegram's own retries also benefit — no double-processing.
  if (typeof update.update_id === "number") {
    const fresh = await markUpdateSeen(update.update_id);
    if (!fresh) {
      return NextResponse.json({ ok: true, replayed: true });
    }
  }

  // Diagnostic: enumerate which update fields are populated. Lets us
  // tell from logs whether Telegram is delivering messages we expect
  // (e.g. group @-mentions) or dropping them upstream due to privacy
  // mode / allowed_updates.
  const updateRecord = update as unknown as Record<string, unknown>;
  const kinds = Object.keys(updateRecord).filter(
    (k) => k !== "update_id" && updateRecord[k] !== undefined,
  );
  const m: { chat?: { id?: number; type?: string }; text?: string; entities?: Array<{ type?: string }>; reply_to_message?: { from?: { id?: number } } } | undefined =
    (update as { message?: unknown }).message as typeof m;
  console.log("[webhook]", {
    updateId: update.update_id,
    kinds,
    chatId: m?.chat?.id,
    chatType: m?.chat?.type,
    textLen: typeof m?.text === "string" ? m.text.length : 0,
    entityTypes: m?.entities?.map((e) => e.type) ?? null,
    isReply: Boolean(m?.reply_to_message),
  });

  const bot = await getBot();

  // Telegram retries on 5xx — never throw out of the handler.
  // Phase 1: handlers are fast; we await inline. Phase 2 will defer LLM work.
  try {
    await bot.handleUpdate(update);
  } catch (error) {
    console.error("[telegram-webhook] handler error", error);
  }

  return NextResponse.json({ ok: true });
}
