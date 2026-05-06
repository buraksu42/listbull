import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { listListsForUser } from "@/lib/db/queries/lists";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const workspaceId = await resolveActiveWorkspaceId(userId);
  const lists = await listListsForUser(userId, workspaceId);
  return NextResponse.json({ ok: true, data: { lists } });
}
