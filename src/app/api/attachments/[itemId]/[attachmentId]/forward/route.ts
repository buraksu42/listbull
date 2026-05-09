/**
 * `POST /api/attachments/[itemId]/[attachmentId]/forward`
 *
 * Re-sends the attachment from the bot to the caller's private DM
 * with the bot, using only the stored `telegram_file_id`. This is
 * a fallback for when the byte-proxy can't render in the Mini App
 * (Telegram CDN expiry, MIME issues, large videos, etc.) and a
 * direct surface for the user's "view in Telegram" muscle memory:
 * once forwarded, the file lives in the bot DM and Telegram client
 * tooling (save to gallery, forward to contact, share) just works.
 *
 * Membership-gated read; same Inv-2 list_members check as GET. No
 * mutation — repeated calls just re-send copies. Each call surfaces
 * a single toast on the client.
 *
 * Failure modes the user might hit:
 *   - bot has no chat with the caller (caller never /start'd) → 403
 *     from Telegram, surface `bot_blocked` so UI can prompt "open
 *     bot first"
 *   - file_id stale (very rare; Telegram retains for years) → 502
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { itemAttachments, items, users } from "@/lib/db/schema";
import { getListMember } from "@/lib/db/queries/members";
import { getBot } from "@/lib/server/bot";
import { attachmentParamsSchema } from "@/lib/validators/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = {
  params: Promise<{ itemId: string; attachmentId: string }>;
};

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

  const member = await getListMember(parent.listId, userId);
  if (!member) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "forbidden", message: "No access to that list" },
      },
      { status: 403 },
    );
  }

  const [u] = await db
    .select({ telegramId: users.telegramId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.telegramId) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "no_telegram_id", message: "Telegram id missing" },
      },
      { status: 500 },
    );
  }

  try {
    const bot = await getBot();
    const fileId = att.telegramFileId;
    const caption = parent.text.length <= 200 ? parent.text : undefined;

    switch (att.kind) {
      case "photo":
        await bot.api.sendPhoto(u.telegramId, fileId, { caption });
        break;
      case "video":
      case "video_note":
        await bot.api.sendVideo(u.telegramId, fileId, { caption });
        break;
      case "voice":
        await bot.api.sendVoice(u.telegramId, fileId, { caption });
        break;
      case "audio":
        await bot.api.sendAudio(u.telegramId, fileId, { caption });
        break;
      case "document":
      default:
        await bot.api.sendDocument(u.telegramId, fileId, { caption });
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Telegram returns 403 with "bot was blocked by the user" or
    // "chat not found" when the caller never DM'd the bot. Surface
    // a distinct code so the UI can prompt them to /start it.
    if (
      msg.includes("bot was blocked") ||
      msg.includes("chat not found") ||
      msg.includes("user is deactivated")
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "bot_blocked",
            message: "Open the bot DM first, then try again.",
          },
        },
        { status: 403 },
      );
    }
    console.error("[attachments/forward] sendX failed", {
      attachmentId,
      kind: att.kind,
      error: msg,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "forward_failed",
          message: msg,
        },
      },
      { status: 502 },
    );
  }
}
