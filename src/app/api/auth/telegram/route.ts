import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { setSessionCookie } from "@/lib/auth/session";
import { verifyTelegramInitData } from "@/lib/auth/telegram-plugin";
import { db } from "@/lib/db/client";
import { ensureInbox } from "@/lib/db/queries/lists";
import { upsertUserFromTelegram } from "@/lib/db/queries/users";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  initData: z.string().min(1),
  /** Browser-detected IANA timezone from
   *  `Intl.DateTimeFormat().resolvedOptions().timeZone`. Used ONLY to
   *  replace the stale UTC default for users who haven't picked a
   *  timezone in Settings yet. Never overrides an explicitly-chosen
   *  value — the server checks `user.timezone === "UTC"` before
   *  applying. Bot users who never open the Mini App stay on UTC
   *  until they say "saat dilimi <X>" to the bot. */
  timezone: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_+\-/]+$/)
    .optional(),
  /** Browser-detected date format (derived from
   *  `Intl.DateTimeFormat().formatToParts` order). Same apply-on-default
   *  rule — never overrides an explicitly-chosen value. */
  dateFormat: z.enum(["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
});

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid body" } },
      { status: 400 },
    );
  }

  let verified;
  try {
    verified = verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "init_data_invalid",
          message: error instanceof Error ? error.message : "Invalid initData",
        },
      },
      { status: 401 },
    );
  }

  const tgUser = verified.user;
  let user = await upsertUserFromTelegram({
    telegramId: tgUser.id,
    telegramUsername: tgUser.username ?? null,
    telegramFirstName: tgUser.first_name,
    telegramLastName: tgUser.last_name ?? null,
    telegramPhotoUrl: tgUser.photo_url ?? null,
    languageCode: tgUser.language_code ?? null,
  });

  // Replace the UTC default with the browser-detected timezone on
  // first Mini App boot. Once the user picks a non-UTC zone (here
  // OR via /settings), we never touch it again — second boot from a
  // different device with a different tz won't surprise-overwrite
  // their choice.
  const patch: Partial<typeof users.$inferInsert> = {};
  if (
    body.timezone &&
    body.timezone !== "UTC" &&
    user.timezone === "UTC"
  ) {
    patch.timezone = body.timezone;
  }
  // Same rule for date_format: only replace when the user is still
  // on the schema default ("DD.MM.YYYY"). Browser-derived value
  // distinguishes US (MM/DD/YYYY) from ISO regions (YYYY-MM-DD) from
  // the bulk default (DD.MM.YYYY).
  if (
    body.dateFormat &&
    body.dateFormat !== "DD.MM.YYYY" &&
    user.dateFormat === "DD.MM.YYYY"
  ) {
    patch.dateFormat = body.dateFormat;
  }
  if (Object.keys(patch).length > 0) {
    patch.updatedAt = new Date();
    const [updated] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, user.id))
      .returning();
    if (updated) user = updated;
  }

  await ensureInbox(user.id);
  await setSessionCookie(user.id);

  return NextResponse.json({
    ok: true,
    data: {
      user: {
        id: user.id,
        telegramId: user.telegramId,
        telegramFirstName: user.telegramFirstName,
        telegramUsername: user.telegramUsername,
        locale: user.locale,
      },
    },
  });
}
