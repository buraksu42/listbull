/**
 * Workspace invite token endpoints.
 *
 *   GET  /api/workspace-invites/[token]  → token info for the
 *                                          accept page (publicly
 *                                          readable; the token's
 *                                          entropy is the gate)
 *   POST /api/workspace-invites/[token]  → accept (auth required)
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import {
  acceptWorkspaceInvite,
  getWorkspaceInviteContextByToken,
} from "@/lib/db/queries/workspace-invites";
import { db } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { setActiveWorkspace } from "@/lib/db/queries/workspaces";
import type { WorkspaceInviteTokenInfo, WorkspaceRole, WorkspaceTier } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: RouteCtx) {
  const { token } = await params;
  const ctxRow = await getWorkspaceInviteContextByToken(token);
  if (!ctxRow) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "not_found", message: "Invite not found" },
      },
      { status: 404 },
    );
  }

  const now = new Date();
  const info: WorkspaceInviteTokenInfo = {
    token,
    workspaceId: ctxRow.workspace.id,
    workspaceName: ctxRow.workspace.name,
    workspaceTier: ctxRow.workspace.tier as WorkspaceTier,
    invitedByName: ctxRow.invitedByName,
    role: ctxRow.invite.role as WorkspaceRole,
    expiresAt: ctxRow.invite.expiresAt.toISOString(),
    isExpired: ctxRow.invite.expiresAt < now,
    isAccepted: ctxRow.invite.acceptedAt !== null,
  };

  return NextResponse.json({ ok: true, data: info });
}

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
  const result = await acceptWorkspaceInvite(token, userId);
  if (!result.ok) {
    const status =
      result.code === "not_found"
        ? 404
        : result.code === "invite_already_accepted"
          ? 409
          : result.code === "invite_username_mismatch"
            ? 403
            : 400;
    return NextResponse.json(
      {
        ok: false,
        error: { code: result.code, message: result.message },
        data: result.workspaceId
          ? { workspaceId: result.workspaceId }
          : undefined,
      },
      { status },
    );
  }

  // Make the new workspace the user's active workspace so /lists
  // immediately reflects the accepted-into context.
  await setActiveWorkspace(userId, result.workspaceId);

  // Update users.active_workspace_id directly via the helper above;
  // no extra round-trip needed here.
  void db;
  void users;
  void eq;

  return NextResponse.json({
    ok: true,
    data: {
      workspaceId: result.workspaceId,
      alreadyAccepted: result.alreadyAccepted,
    },
  });
}
