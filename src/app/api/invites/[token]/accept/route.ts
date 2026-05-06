/**
 * `POST /api/invites/[token]/accept` — atomic membership creation.
 *
 * Auth-gated (the user must have completed Telegram initData verification
 * via Better Auth). The transaction lives in `acceptInvite`:
 *   - SELECT FOR UPDATE on the invite row.
 *   - Validate accepted_at, expires_at, lower(caller.telegramUsername).
 *   - INSERT list_members + UPDATE list_invites + INSERT activity_log.
 *
 * Tokens MUST NOT be logged (Inv-10).
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { acceptInvite } from "@/lib/db/queries/invites";
import type { AcceptInviteResponse } from "@/lib/validators/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ token: string }> };

export async function POST(_request: Request, { params }: RouteCtx) {
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

  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Invite not found" } },
      { status: 404 },
    );
  }

  const result = await acceptInvite(token, userId);
  if (!result.ok) {
    // `invite_already_accepted` is treated as idempotent success at the
    // HTTP layer: 200 with the listId so the client can navigate. The
    // error code is preserved in the body for the caller to log/UI.
    if (result.code === "invite_already_accepted" && result.listId) {
      const data: AcceptInviteResponse = {
        listId: result.listId,
        alreadyAccepted: true,
      };
      return NextResponse.json({ ok: true, data });
    }
    const status = errorCodeToStatus(result.code);
    return NextResponse.json(
      {
        ok: false,
        error: { code: result.code, message: result.message },
      },
      { status },
    );
  }

  const data: AcceptInviteResponse = {
    listId: result.listId,
    alreadyAccepted: result.alreadyAccepted,
  };
  return NextResponse.json({ ok: true, data });
}

function errorCodeToStatus(code: string): number {
  switch (code) {
    case "invite_expired":
    case "invite_username_mismatch":
      return 403;
    case "not_found":
      return 404;
    default:
      return 500;
  }
}
