/**
 * `POST /api/workspaces/[id]/bulk-restore` — Phase 6.5 admin power
 * feature. Workspace owner restores up to N item_deleted activity
 * entries in a single batch.
 *
 * Request body: { activityIds: string[] }
 * Response: { restored: number, failed: Array<{ id, reason }> }
 *
 * Owner-only at workspace level — bypasses the per-list owner check
 * the F2 single-item restore enforces, since workspace ownership
 * implies authority over every list in the workspace.
 *
 * Per-row handling:
 *   - skip if activity_log row not found
 *   - skip if action !== 'item_deleted'
 *   - skip if older than 30 days (Inv-21 window)
 *   - skip if the activity's list is not in this workspace
 *   - skip if payload_before is malformed
 *
 * Failures don't abort the batch; each row's outcome is reported
 * back so the UI can show partial-success state.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { eq } from "drizzle-orm";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  activityLog,
  items,
  lists,
} from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const itemSnapshotSchema = z.object({
  id: z.string(),
  listId: z.string(),
  text: z.string(),
  isCheckable: z.boolean(),
  isDone: z.boolean(),
  assigneeId: z.string().nullable(),
  // Phase 14d: deadlineAt is the canonical field; legacy dueAt is
  // accepted for back-compat with old activity_log rows.
  deadlineAt: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  reminderSent: z.boolean().optional(),
  position: z.number(),
  createdBy: z.string(),
  completedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId } = await params;
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Workspace owner only" } },
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
  const { activityIds } = body as { activityIds?: unknown };
  if (!Array.isArray(activityIds) || activityIds.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "activityIds must be a non-empty array",
        },
      },
      { status: 400 },
    );
  }
  if (activityIds.length > 100) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "activityIds may not exceed 100 entries per request",
        },
      },
      { status: 400 },
    );
  }
  for (const id of activityIds) {
    if (typeof id !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "invalid_input",
            message: "activityIds entries must be strings",
          },
        },
        { status: 400 },
      );
    }
  }

  const ids = activityIds as string[];
  let restored = 0;
  const failed: Array<{ id: string; reason: string }> = [];

  for (const activityId of ids) {
    const result = await restoreOne(workspaceId, activityId);
    if (result.ok) {
      restored += 1;
    } else {
      failed.push({ id: activityId, reason: result.reason });
    }
  }

  return NextResponse.json({
    ok: true,
    data: { restored, failed },
  });
}

async function restoreOne(
  workspaceId: string,
  activityLogId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [logRow] = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.id, activityLogId))
    .limit(1);
  if (!logRow) return { ok: false, reason: "not_found" };
  if (logRow.action !== "item_deleted") {
    return { ok: false, reason: "not_restorable" };
  }
  if (Date.now() - logRow.createdAt.getTime() > RESTORE_WINDOW_MS) {
    return { ok: false, reason: "restore_window_expired" };
  }
  if (!logRow.listId) return { ok: false, reason: "not_restorable" };

  // Workspace scope check.
  const [listRow] = await db
    .select({
      id: lists.id,
      workspaceId: lists.workspaceId,
      archivedAt: lists.archivedAt,
    })
    .from(lists)
    .where(eq(lists.id, logRow.listId))
    .limit(1);
  if (!listRow || listRow.workspaceId !== workspaceId) {
    return { ok: false, reason: "not_found" };
  }
  if (listRow.archivedAt) {
    return { ok: false, reason: "list_archived" };
  }

  const parsed = itemSnapshotSchema.safeParse(logRow.payloadBefore);
  if (!parsed.success) {
    return { ok: false, reason: "restore_payload_invalid" };
  }
  const snap = parsed.data;

  await db.transaction(async (tx) => {
    // Phase 14d: prefer canonical deadlineAt, fall back to legacy dueAt.
    const deadlineSource = snap.deadlineAt ?? snap.dueAt ?? null;
    const deadlineAt = deadlineSource ? new Date(deadlineSource) : null;

    const [created] = await tx
      .insert(items)
      .values({
        listId: snap.listId,
        text: snap.text,
        isCheckable: snap.isCheckable,
        isDone: false,
        assigneeId: null,
        deadlineAt,
        position: snap.position,
        createdBy: snap.createdBy,
        completedAt: null,
        archivedAt: null,
      })
      .returning();
    if (!created) throw new Error("bulk-restore: insert returned no row");

    // Activity log row for the restore (item_created mirrors single-
    // restore convention; preserves the audit chain). Use the shared
    // snapshot helper so the new shape (status/priority/tags) is
    // serialized consistently.
    const { toItemSnapshot } = await import("@/lib/db/snapshots");
    await tx.insert(activityLog).values({
      listId: created.listId,
      entityType: "item",
      entityId: created.id,
      action: "item_created",
      actorId: snap.createdBy,
      payloadBefore: null,
      payloadAfter: toItemSnapshot(created),
    });
  });

  return { ok: true };
}
