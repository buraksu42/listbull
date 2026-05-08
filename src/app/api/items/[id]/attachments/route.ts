/**
 * Mini App attachments API — GET /api/items/[id]/attachments (Phase 14b).
 *
 * Read-only enumerator. Any list role (viewer included) can list. The
 * raw `telegram_file_id` is intentionally NOT exposed — clients fetch
 * bytes via `/api/attachments/[itemId]/[attachmentId]` keyed by the
 * row's UUID.
 */
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { itemAttachments, items } from "@/lib/db/schema";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { userCanReadList } from "@/lib/db/queries/items";
import { toAttachmentSnapshot } from "@/lib/db/snapshots";
import { itemAttachmentsListParamsSchema } from "@/lib/validators/attachments";

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
  const idCheck = itemAttachmentsListParamsSchema.safeParse({ itemId: id });
  if (!idCheck.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: "Invalid item id" },
      },
      { status: 400 },
    );
  }

  const [parent] = await db
    .select()
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  if (!parent || parent.archivedAt) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Item not found" } },
      { status: 404 },
    );
  }

  const workspaceId = await resolveActiveWorkspaceId(userId);
  const allowed = await userCanReadList(userId, parent.listId, workspaceId);
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "forbidden", message: "No access to that list" },
      },
      { status: 403 },
    );
  }

  const rows = await db
    .select()
    .from(itemAttachments)
    .where(eq(itemAttachments.itemId, id))
    .orderBy(asc(itemAttachments.createdAt));

  return NextResponse.json({
    ok: true,
    data: { attachments: rows.map(toAttachmentSnapshot) },
  });
}
