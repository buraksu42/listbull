/**
 * `DELETE /api/workspaces/[id]/members/[memberId]` — remove member
 * `PATCH  /api/workspaces/[id]/members/[memberId]` — change role
 *
 * Owner-only on both. Cascades documented in
 * executeRemoveWorkspaceMember (list_members + items.assignee_id
 * cleanup); we delegate via the existing executor when possible.
 */
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  activityLog,
  workspaceMembers,
} from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { executeRemoveWorkspaceMember } from "@/lib/server/tools/remove-workspace-member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; memberId: string }> };

const VALID_ROLES = new Set(["admin", "editor", "viewer", "guest"]);

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId, memberId } = await params;

  // Resolve member → user_id so we can pass it to the executor.
  const [member] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!member) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Member not found" } },
      { status: 404 },
    );
  }

  // Reuse the executor (owner gate, cascade, activity_log).
  const result = await executeRemoveWorkspaceMember(
    { user_id: member.userId },
    { userId, workspaceId },
  );
  if (!result.ok) {
    const status =
      result.error.code === "forbidden"
        ? 403
        : result.error.code === "cannot_remove_owner" ||
            result.error.code === "cannot_remove_self"
          ? 400
          : 404;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}

export async function PATCH(request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId, memberId } = await params;

  // Owner-only.
  const callerMembership = await getWorkspaceMembership(userId, workspaceId);
  if (!callerMembership) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Workspace not found" } },
      { status: 404 },
    );
  }
  if (callerMembership.role !== "owner") {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Owner only" } },
      { status: 403 },
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

  const { role } = body as { role?: unknown };
  if (typeof role !== "string" || !VALID_ROLES.has(role)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "role must be one of admin/editor/viewer/guest",
        },
      },
      { status: 400 },
    );
  }

  const [target] = await db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role, userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!target) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Member not found" } },
      { status: 404 },
    );
  }
  if (target.role === "owner") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "cannot_change_owner",
          message: "Owner role isn't transferable via this surface.",
        },
      },
      { status: 400 },
    );
  }

  const previousRole = target.role;
  await db.transaction(async (tx) => {
    await tx
      .update(workspaceMembers)
      .set({ role, updatedAt: new Date() })
      .where(eq(workspaceMembers.id, memberId));

    await tx.insert(activityLog).values({
      listId: null,
      entityType: "workspace",
      entityId: workspaceId,
      action: "workspace_member_role_changed",
      actorId: userId,
      payloadBefore: {
        workspaceId,
        userId: target.userId,
        role: previousRole,
      },
      payloadAfter: {
        workspaceId,
        userId: target.userId,
        role,
      },
    });
  });

  return NextResponse.json({
    ok: true,
    data: { memberId, role },
  });
}
