import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { listListsForUser } from "@/lib/db/queries/lists";

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

  const lists = await listListsForUser(userId);
  return NextResponse.json({ ok: true, data: { lists } });
}
