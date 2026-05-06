/**
 * `POST /api/telegram/webhook/[botId]` — per-bot webhook router.
 * Phase 5 multi-bot support.
 *
 * URL format: each registered bot (white-label) has its own webhook
 * URL. The bot ID in the path uniquely identifies which `bots` row
 * the update belongs to. Per-bot webhook secret is verified against
 * `bots.webhook_secret`.
 *
 * Default platform bot continues to use the legacy
 * /api/telegram/webhook (no bot ID) — that route reads
 * env.TELEGRAM_WEBHOOK_SECRET. White-label bots use this route.
 */
import type { Update } from "grammy/types";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { bots } from "@/lib/db/schema";
import { getBotById } from "@/lib/server/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

type RouteCtx = { params: Promise<{ botId: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const { botId } = await params;

  // Verify per-bot webhook secret. The Telegram-set
  // x-telegram-bot-api-secret-token header is bound to the bot's
  // webhook URL — different bots use different secrets.
  const provided = request.headers.get(SECRET_HEADER);
  const [row] = await db
    .select({ webhookSecret: bots.webhookSecret })
    .from(bots)
    .where(eq(bots.id, botId))
    .limit(1);
  if (!row) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "not_found", message: "Bot not registered" },
      },
      { status: 404 },
    );
  }
  if (provided !== row.webhookSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "unauthorized", message: "Invalid webhook secret" },
      },
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

  const bot = await getBotById(botId);
  if (!bot) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "internal_error", message: "Bot init failed" },
      },
      { status: 500 },
    );
  }

  try {
    await bot.handleUpdate(update);
  } catch (error) {
    console.error("[telegram-webhook]", botId, "handler error", error);
  }

  return NextResponse.json({ ok: true });
}
