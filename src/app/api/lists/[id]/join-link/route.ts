/**
 * `GET /api/lists/[id]/join-link` — owner-only. Returns a username-
 * less share URL for the list. Lazily generates `lists.join_link_token`
 * on first call. The URL is `t.me/<bot>?start=joinlist_<token>`.
 *
 * Phase 16/#29 — pairs with the existing username-required /invite
 * endpoint. Anyone with the link who is already in the workspace
 * joins the list as editor on tap.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { isListOwner } from "@/lib/db/queries/members";
import { ensureListJoinToken } from "@/lib/db/queries/lists";
import { env } from "@/lib/env";

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

  const { id: listId } = await params;
  const owner = await isListOwner(userId, listId);
  if (!owner) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "forbidden",
          message: "Only the list owner can share a link.",
        },
      },
      { status: 403 },
    );
  }

  const token = await ensureListJoinToken(listId);
  const url = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=joinlist_${token}`;
  return NextResponse.json({ ok: true, data: { token, url } });
}
