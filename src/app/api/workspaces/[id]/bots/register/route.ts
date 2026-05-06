/**
 * `POST /api/workspaces/[id]/bots/register` — register a white-label
 * Telegram bot for a Workspace-tier workspace.
 *
 * Caller must be the workspace owner. Body: { token, webhookSecret? }.
 * Validates the token via Telegram `getMe` API, persists encrypted
 * token + (operator-supplied or randomly-generated) webhook secret,
 * binds the bot to the workspace via `workspace_bots` row with
 * is_primary=true, then sets the Telegram webhook URL via the
 * `setWebhook` API.
 *
 * On success, returns the bot's username + webhook URL the operator
 * should configure in Telegram (auto-set if Telegram accepts).
 */
import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { bots, workspaceBots, workspaces } from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { encrypt } from "@/lib/server/encryption";
import { enforceTier } from "@/lib/server/middleware/tier-enforce";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

type GetMeResponse = {
  ok: boolean;
  result?: {
    id: number;
    username: string;
    first_name: string;
    is_bot: boolean;
  };
  description?: string;
};

export async function POST(request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId } = await params;

  // Owner-only.
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Workspace not found" } },
      { status: 404 },
    );
  }
  if (membership.role !== "owner") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "forbidden",
          message: "Only the workspace owner can register a custom bot",
        },
      },
      { status: 403 },
    );
  }

  // Tier gate: white-label bots are Workspace-tier only. Phase 5
  // logs (BILLING_ENFORCE=false). Phase 5 launch flips to enforce.
  const tierResult = await enforceTier(workspaceId, {
    type: "set_org_api_key",
  });
  if (tierResult.enforced) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: tierResult.reason,
          message: tierResult.message,
          upgradeTo: tierResult.upgradeTo,
        },
      },
      { status: 402 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }
  const { token } = body as { token?: unknown };
  if (typeof token !== "string" || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "Token format invalid (expected '<id>:<secret>')",
        },
      },
      { status: 400 },
    );
  }

  // Validate token via Telegram getMe.
  let info: GetMeResponse["result"];
  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const tgJson = (await tgRes.json()) as GetMeResponse;
    if (!tgJson.ok || !tgJson.result || !tgJson.result.is_bot) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "invalid_token",
            message: tgJson.description ?? "Telegram rejected the token",
          },
        },
        { status: 400 },
      );
    }
    info = tgJson.result;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "telegram_unreachable",
          message: err instanceof Error ? err.message : "Telegram API failed",
        },
      },
      { status: 502 },
    );
  }

  // Idempotency: if the bot ID is already registered to ANOTHER
  // workspace, reject. If registered to THIS workspace already,
  // refresh the token + webhook secret.
  const [existing] = await db
    .select({ id: bots.id, isDefault: bots.isDefault })
    .from(bots)
    .where(eq(bots.telegramBotId, info.id))
    .limit(1);

  if (existing && existing.isDefault) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "default_bot_collision",
          message: "This is the platform's default bot — cannot bind it as white-label.",
        },
      },
      { status: 409 },
    );
  }

  const tokenEncrypted = encrypt(token);
  const webhookSecret = randomBytes(24).toString("base64url");

  const botRowId = await db.transaction(async (tx) => {
    let id: string;
    if (existing) {
      // Update path: refresh token + secret.
      await tx
        .update(bots)
        .set({
          telegramBotUsername: info.username,
          telegramBotTokenEncrypted: tokenEncrypted,
          webhookSecret,
          updatedAt: new Date(),
        })
        .where(eq(bots.id, existing.id));
      id = existing.id;

      // Verify this workspace already has a binding.
      const [binding] = await tx
        .select({ id: workspaceBots.id })
        .from(workspaceBots)
        .where(
          and(
            eq(workspaceBots.botId, id),
            eq(workspaceBots.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!binding) {
        await tx.insert(workspaceBots).values({
          workspaceId,
          botId: id,
          isPrimary: true,
        });
      }
    } else {
      const [created] = await tx
        .insert(bots)
        .values({
          telegramBotId: info.id,
          telegramBotUsername: info.username,
          telegramBotTokenEncrypted: tokenEncrypted,
          webhookSecret,
          isDefault: false,
          createdBy: userId,
        })
        .returning({ id: bots.id });
      if (!created) throw new Error("register: bot insert returned no row");
      id = created.id;

      await tx.insert(workspaceBots).values({
        workspaceId,
        botId: id,
        isPrimary: true,
      });
    }

    // Cache invariance: workspaces.tier doesn't change on this
    // operation; nothing to refresh.
    void workspaces;
    return id;
  });

  // Configure Telegram-side webhook so updates land on our per-bot
  // route. Best-effort — if it fails, the operator can rerun this
  // POST or paste the URL manually in BotFather.
  const webhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/telegram/webhook/${botRowId}`;
  let webhookSet = false;
  let webhookError: string | null = null;
  try {
    const setRes = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhookSecret,
          drop_pending_updates: true,
        }),
      },
    );
    const setJson = (await setRes.json()) as {
      ok: boolean;
      description?: string;
    };
    webhookSet = setJson.ok === true;
    if (!setJson.ok) webhookError = setJson.description ?? "Telegram refused";
  } catch (err) {
    webhookError = err instanceof Error ? err.message : "setWebhook failed";
  }

  return NextResponse.json({
    ok: true,
    data: {
      bot: {
        id: botRowId,
        telegramBotId: info.id,
        username: info.username,
        firstName: info.first_name,
      },
      webhookUrl,
      webhookSet,
      webhookError,
    },
  });
}
