/**
 * `GET /api/workspaces/[id]/members` — workspace members list.
 * `POST /api/workspaces/[id]/members` — owner/admin invite a new
 *                                       member (delegates to
 *                                       executeInviteToWorkspace).
 *
 * Membership-gated read; owner/admin-gated invite (the executor
 * enforces). Read shape mirrors per-list members API.
 */
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getSessionUserId } from "@/lib/auth/session";
import {
  getWorkspaceMembership,
  listWorkspaceMembers,
} from "@/lib/db/queries/workspaces";
import { listPendingWorkspaceInvites } from "@/lib/db/queries/workspace-invites";
import { executeInviteToWorkspace } from "@/lib/server/tools/invite-to-workspace";

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

  const [members, pendingInvites] = await Promise.all([
    listWorkspaceMembers(workspaceId),
    listPendingWorkspaceInvites(workspaceId),
  ]);
  const botUsername = env.TELEGRAM_BOT_USERNAME;
  const pending = pendingInvites.map((inv) => ({
    ...inv,
    deeplink: `https://t.me/${botUsername}?startapp=wsinvite_${inv.token}`,
  }));
  return NextResponse.json({ ok: true, data: { members, pendingInvites: pending } });
}

export async function POST(request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const { username, role } = body as {
    username?: unknown;
    role?: unknown;
  };
  if (typeof username !== "string" || username.trim().length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "username is required",
        },
      },
      { status: 400 },
    );
  }
  const roleParsed =
    typeof role === "string" && /^(admin|editor|viewer|guest)$/.test(role)
      ? (role as "admin" | "editor" | "viewer" | "guest")
      : "editor";

  // Reuse the executor (auth + tier + DM logic in one place). The
  // executor's ctx.workspaceId is the active workspace; here we
  // pass the URL-supplied workspaceId so invites can be made from
  // any workspace's settings page (not just the active one).
  const result = await executeInviteToWorkspace(
    { username, role: roleParsed },
    { userId, workspaceId },
  );

  if (!result.ok) {
    const status =
      result.error.code === "forbidden"
        ? 403
        : result.error.code === "not_found"
          ? 404
          : result.error.code === "tier_exceeded" ||
              result.error.code === "past_due_locked"
            ? 402
            : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
