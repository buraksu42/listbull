import type { Update } from "grammy/types";
import { NextResponse } from "next/server";

import { getBot } from "@/lib/server/bot";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export async function POST(request: Request) {
  const provided = request.headers.get(SECRET_HEADER);
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Invalid webhook secret" } },
      { status: 401 },
    );
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

  const bot = getBot();

  // Telegram retries on 5xx — never throw out of the handler.
  // Phase 1: handlers are fast; we await inline. Phase 2 will defer LLM work.
  try {
    await bot.handleUpdate(update);
  } catch (error) {
    console.error("[telegram-webhook] handler error", error);
  }

  return NextResponse.json({ ok: true });
}
