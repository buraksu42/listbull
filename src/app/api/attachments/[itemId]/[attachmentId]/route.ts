/**
 * Mini App attachments byte proxy (Phase 14b).
 *
 * GET    /api/attachments/[itemId]/[attachmentId]
 *   Streams the file's bytes back to the Mini App. Resolution order:
 *     1. Hetzner backup (when `storage_backed_up_at IS NOT NULL`).
 *        TODO Phase 14b.1: 302 to a pre-signed Hetzner URL.
 *     2. Telegram CDN — `bot.api.getFile()` returns a 1h-valid URL;
 *        we fetch it server-side and stream the body back so the
 *        Telegram URL never leaks to the client (its bot-token
 *        suffix would otherwise be observable).
 *     3. 503 when neither path works.
 *   Cache-Control: private 45min so a second open in the lightbox
 *   doesn't re-pay the Telegram round-trip; intentionally below
 *   the 1h Telegram URL TTL to avoid stale-link 404s.
 *
 * DELETE /api/attachments/[itemId]/[attachmentId]
 *   Hard-deletes the attachment row + writes activity_log. Write
 *   permission required (owner | editor on the parent item's list).
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { activityLog, itemAttachments, items } from "@/lib/db/schema";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import {
  userCanReadList,
  userCanWriteList,
} from "@/lib/db/queries/items";
import { toAttachmentSnapshot } from "@/lib/db/snapshots";
import { getBot } from "@/lib/server/bot";
import { attachmentParamsSchema } from "@/lib/validators/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = {
  params: Promise<{ itemId: string; attachmentId: string }>;
};

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

  const { itemId, attachmentId } = await params;
  const check = attachmentParamsSchema.safeParse({ itemId, attachmentId });
  if (!check.success) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "Invalid id" } },
      { status: 400 },
    );
  }

  const [att] = await db
    .select()
    .from(itemAttachments)
    .where(eq(itemAttachments.id, attachmentId))
    .limit(1);
  if (!att || att.itemId !== itemId) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "not_found", message: "Attachment not found" },
      },
      { status: 404 },
    );
  }

  const [parent] = await db
    .select()
    .from(items)
    .where(eq(items.id, att.itemId))
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

  // TODO Phase 14b.1: when storageKey/storageBackedUpAt are set, prefer
  // the Hetzner pre-signed URL (302 redirect). For now, always go via
  // the Telegram CDN — works while the Hetzner backup cron is being
  // rolled out.
  try {
    const bot = await getBot();
    const file = await bot.api.getFile(att.telegramFileId);
    if (!file.file_path) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "not_found", message: "File path missing" },
        },
        { status: 404 },
      );
    }
    // Telegram CDN URL embeds the bot token; never expose it client-side.
    const tgUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
    const upstream = await fetch(tgUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "upstream_error",
            message: `Telegram returned ${upstream.status}`,
          },
        },
        { status: 502 },
      );
    }
    const headers = new Headers();
    const upstreamMime = upstream.headers.get("content-type");
    headers.set(
      "content-type",
      upstreamMime ?? att.mimeType ?? "application/octet-stream",
    );
    if (upstream.headers.get("content-length")) {
      headers.set(
        "content-length",
        upstream.headers.get("content-length") as string,
      );
    }
    // 45 min < Telegram's 1h URL TTL so we never serve a known-stale link.
    headers.set("cache-control", "private, max-age=2700");
    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "fetch_failed",
          message: e instanceof Error ? e.message : "fetch failed",
        },
      },
      { status: 502 },
    );
  }
}

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

  const { itemId, attachmentId } = await params;
  const check = attachmentParamsSchema.safeParse({ itemId, attachmentId });
  if (!check.success) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "Invalid id" } },
      { status: 400 },
    );
  }

  const workspaceId = await resolveActiveWorkspaceId(userId);

  const result = await db.transaction(async (tx) => {
    const [att] = await tx
      .select()
      .from(itemAttachments)
      .where(eq(itemAttachments.id, attachmentId))
      .limit(1);
    if (!att || att.itemId !== itemId) {
      return { ok: false as const, code: "not_found", status: 404 };
    }
    const [parent] = await tx
      .select()
      .from(items)
      .where(eq(items.id, att.itemId))
      .limit(1);
    if (!parent || parent.archivedAt) {
      return { ok: false as const, code: "not_found", status: 404 };
    }
    const allowed = await userCanWriteList(userId, parent.listId, workspaceId);
    if (!allowed) {
      return { ok: false as const, code: "forbidden", status: 403 };
    }

    const snapshot = toAttachmentSnapshot(att);
    await tx
      .delete(itemAttachments)
      .where(eq(itemAttachments.id, attachmentId));
    await tx.insert(activityLog).values({
      listId: parent.listId,
      entityType: "item",
      entityId: parent.id,
      action: "item_attachment_removed",
      actorId: userId,
      payloadBefore: snapshot,
      payloadAfter: null,
    });
    return { ok: true as const, snapshot };
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: result.code, message: result.code },
      },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, data: { attachment_id: attachmentId } });
}
