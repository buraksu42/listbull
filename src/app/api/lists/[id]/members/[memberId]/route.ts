/**
 * `DELETE /api/lists/[id]/members/[memberId]` — owner-only member removal.
 * `PATCH  /api/lists/[id]/members/[memberId]` — owner-only role change
 * (Phase 3 plumbing only; UI surfaces this in Phase 4).
 *
 * Inv-12: removing a member also clears `assignee_id` on every item in
 * the list assigned to them, all in one transaction. Inv-13: writes
 * `member_removed` (or `member_role_changed`) activity_log row.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { removeMember, updateMemberRole } from "@/lib/db/queries/members";
import { patchMemberRoleBodySchema } from "@/lib/validators/invites";
import type {
  RemoveMemberResponse,
  UpdateMemberRoleResponse,
} from "@/lib/validators/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = {
  params: Promise<{ id: string; memberId: string }>;
};

export async function DELETE(_request: Request, { params }: RouteCtx) {
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

  const { id, memberId } = await params;
  const result = await removeMember(id, memberId, userId);
  if (!result.ok) {
    const status = errorCodeToStatus(result.code);
    return NextResponse.json(
      {
        ok: false,
        error: { code: result.code, message: result.message },
      },
      { status },
    );
  }

  const data: RemoveMemberResponse = { removedItemCount: result.removedItemCount };
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(request: Request, { params }: RouteCtx) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const parsed = patchMemberRoleBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }

  const { id, memberId } = await params;
  const result = await updateMemberRole(id, memberId, parsed.data.role, userId);
  if (!result.ok) {
    const status = errorCodeToStatus(result.code);
    return NextResponse.json(
      {
        ok: false,
        error: { code: result.code, message: result.message },
      },
      { status },
    );
  }
  const data: UpdateMemberRoleResponse = { member: result.member };
  return NextResponse.json({ ok: true, data });
}

function errorCodeToStatus(code: string): number {
  switch (code) {
    case "forbidden":
    case "cannot_remove_owner":
    case "cannot_change_owner":
      return 403;
    case "not_found":
      return 404;
    case "invalid_input":
    case "bad_input":
      return 400;
    default:
      return 500;
  }
}
