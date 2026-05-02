/**
 * `GET /api/invites/[token]` — public-ish invite info for the accept
 * screen. The token's 256-bit entropy IS the auth surface (Inv-10);
 * we do not require a Better Auth session because the invitee may not
 * yet have one (their first time touching the app).
 *
 * Tokens MUST NOT be logged here or anywhere else (Inv-10).
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { getInviteContextByToken } from "@/lib/db/queries/invites";
import { getUserById } from "@/lib/db/queries/users";
import type { InviteTokenInfo, ListRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: RouteCtx) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Invite not found" } },
      { status: 404 },
    );
  }

  const ctx = await getInviteContextByToken(token);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Invite not found" } },
      { status: 404 },
    );
  }

  const now = Date.now();
  const isExpired = ctx.invite.expiresAt.getTime() < now;
  const isAccepted = ctx.invite.acceptedAt !== null;

  // Compute whether the currently-authenticated user (if any) can accept
  // this invite. Used to gate UI affordances client-side.
  let currentUserCanAccept = false;
  const sessionUserId = await getSessionUserId();
  if (sessionUserId && !isExpired && !isAccepted) {
    const user = await getUserById(sessionUserId);
    const lowered = (user?.telegramUsername ?? "").toLowerCase();
    currentUserCanAccept =
      lowered.length > 0 && lowered === ctx.invite.invitedUsername;
  }

  const info: InviteTokenInfo = {
    token: ctx.invite.token,
    listId: ctx.list.id,
    listName: ctx.list.name,
    listEmoji: ctx.list.emoji,
    invitedByName: ctx.invitedByName,
    role: ctx.invite.role as ListRole,
    expiresAt: ctx.invite.expiresAt.toISOString(),
    isExpired,
    isAccepted,
  };

  return NextResponse.json({
    ok: true,
    data: { invite: info, currentUserCanAccept },
  });
}
