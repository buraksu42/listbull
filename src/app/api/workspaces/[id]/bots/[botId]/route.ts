/**
 * `DELETE /api/workspaces/[id]/bots/[botId]` — revoke a workspace's
 * white-label bot binding. Owner-only. Cannot revoke the default
 * platform bot binding.
 *
 * Side effects:
 *  - DELETE workspace_bots row
 *  - if this binding was is_primary AND no other workspace uses
 *    this bot, also DELETE bots row (cascade by FK)
 *  - call Telegram setWebhook with empty URL to detach the webhook
 *    (best-effort — operator can re-attach manually if it fails)
 *  - evict bot from in-memory pool so any future webhook hits get
 *    rebuilt against the (now-deleted) row → 404
 */
import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { bots, workspaceBots } from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { evictBotFromPool } from "@/lib/server/bot";
import { decrypt } from "@/lib/server/encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; botId: string }> };

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId, botId } = await params;
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Owner only" } },
      { status: 403 },
    );
  }

  const [bot] = await db
    .select({
      id: bots.id,
      isDefault: bots.isDefault,
      tokenEncrypted: bots.telegramBotTokenEncrypted,
    })
    .from(bots)
    .where(eq(bots.id, botId))
    .limit(1);
  if (!bot) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Bot not found" } },
      { status: 404 },
    );
  }
  if (bot.isDefault) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "cannot_revoke_default",
          message: "Cannot revoke the platform's default bot binding.",
        },
      },
      { status: 400 },
    );
  }

  // Best-effort: detach Telegram webhook BEFORE we delete the row,
  // so any in-flight updates have a clean failure mode (Telegram
  // gets removed-from-our-side). Decrypt to call setWebhook.
  let token: string | null = null;
  try {
    token = decrypt(bot.tokenEncrypted);
  } catch {
    // If we can't decrypt, we can't tell Telegram — proceed with DB
    // delete anyway. Operator may have rotated keys; orphan webhook
    // on Telegram side will 404 against our route and Telegram will
    // eventually back off.
  }
  if (token) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "" }),
      });
    } catch {
      // Don't block the revoke on Telegram-side failure.
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(workspaceBots)
      .where(
        and(
          eq(workspaceBots.workspaceId, workspaceId),
          eq(workspaceBots.botId, botId),
        ),
      );

    // If no other workspace binds this bot, drop the bot row entirely
    // so the token doesn't sit unused in encrypted storage.
    const [otherBinding] = await tx
      .select({ id: workspaceBots.id })
      .from(workspaceBots)
      .where(and(eq(workspaceBots.botId, botId), ne(workspaceBots.workspaceId, workspaceId)))
      .limit(1);
    if (!otherBinding) {
      await tx.delete(bots).where(eq(bots.id, botId));
    }
  });

  evictBotFromPool(botId);

  return NextResponse.json({ ok: true });
}
