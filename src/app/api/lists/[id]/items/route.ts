import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import {
  getList,
  listItemsInList,
  userCanReadList,
} from "@/lib/db/queries/lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id } = await params;

  const canRead = await userCanReadList(userId, id);
  if (!canRead) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "List not found" } },
      { status: 404 },
    );
  }

  const list = await getList(id);
  if (!list) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "List not found" } },
      { status: 404 },
    );
  }

  const items = await listItemsInList(id);
  return NextResponse.json({ ok: true, data: { list, items } });
}
