import { NextResponse } from "next/server";
import { z } from "zod";

import { setSessionCookie } from "@/lib/auth/session";
import { verifyTelegramInitData } from "@/lib/auth/telegram-plugin";
import { ensureInbox } from "@/lib/db/queries/lists";
import { upsertUserFromTelegram } from "@/lib/db/queries/users";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ initData: z.string().min(1) });

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
  const user = await upsertUserFromTelegram({
    telegramId: tgUser.id,
    telegramUsername: tgUser.username ?? null,
    telegramFirstName: tgUser.first_name,
    telegramLastName: tgUser.last_name ?? null,
    telegramPhotoUrl: tgUser.photo_url ?? null,
    languageCode: tgUser.language_code ?? null,
  });

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
