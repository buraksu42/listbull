/**
 * `GET /api/items/[id]/locate` — minimal lookup that returns the
 * containing list ID for a given item, used by the Mini App boot
 * route to resolve inline-mode `?startapp=item_<id>` deeplinks.
 *
 * Returns 404 if the item is missing/archived OR the caller has no
 * read access to the item's list (no leakage of which list it
 * lives in). The membership check matches the existing item read
 * gate.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers } from "@/lib/db/schema";
import { getSessionUserId } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "unauthorized", message: "Sign in via Telegram" },
      },
      { status: 401 },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "missing id" } },
      { status: 400 },
    );
  }

  // One-shot SELECT joined to list_members so we 404 if the caller
  // isn't a member of the item's list. Inv-2 — leakage prevention.
  const [row] = await db
    .select({ listId: items.listId })
    .from(items)
    .innerJoin(
      listMembers,
      and(
        eq(listMembers.listId, items.listId),
        eq(listMembers.userId, userId),
      ),
    )
    .where(eq(items.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Item not found" } },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, data: { listId: row.listId } });
}
