/**
 * `GET /api/workspaces/[id]/bots` — list bots bound to a workspace.
 * Read-only; any role can call. Returns public-safe view (no token,
 * no webhook secret).
 */
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { bots, workspaceBots } from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId } = await params;
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Not a member" } },
      { status: 403 },
    );
  }

  const rows = await db
    .select({
      botId: bots.id,
      telegramBotId: bots.telegramBotId,
      username: bots.telegramBotUsername,
      isDefault: bots.isDefault,
      isPrimary: workspaceBots.isPrimary,
      boundAt: workspaceBots.createdAt,
    })
    .from(workspaceBots)
    .innerJoin(bots, eq(bots.id, workspaceBots.botId))
    .where(eq(workspaceBots.workspaceId, workspaceId))
    .orderBy(desc(workspaceBots.isPrimary), desc(bots.isDefault));
  void and; // kept for future filter additions

  return NextResponse.json({
    ok: true,
    data: {
      bots: rows.map((r) => ({
        botId: r.botId,
        telegramBotId: r.telegramBotId,
        username: r.username,
        isDefault: r.isDefault,
        isPrimary: r.isPrimary,
        boundAt: r.boundAt.toISOString(),
      })),
    },
  });
}
