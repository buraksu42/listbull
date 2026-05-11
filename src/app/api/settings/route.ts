/**
 * Mini App settings API — GET /api/settings (read prefs), PATCH
 * /api/settings (mutate any subset). Per-user BYOK was removed; the
 * OpenRouter API key is workspace-scoped and lives behind
 * /api/workspaces/[id]/org-key.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  patchSettingsBodySchema,
  type AllowedDateFormat,
  type AllowedTimeFormat,
  type GetSettingsResponse,
} from "@/lib/validators/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "User not found" } },
      { status: 404 },
    );
  }

  const data: GetSettingsResponse = {
    locale: user.locale === "tr" ? "tr" : "en",
    timezone: user.timezone,
    llmModel: user.llmModel,
    notificationsEnabled: user.notificationsEnabled,
    dateFormat: user.dateFormat as AllowedDateFormat,
    timeFormat: user.timeFormat as AllowedTimeFormat,
  };

  return NextResponse.json({ ok: true, data });
}

export async function PATCH(request: Request) {
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

  const parsed = patchSettingsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }
  const {
    locale,
    timezone,
    llmModel,
    notificationsEnabled,
    dateFormat,
    timeFormat,
  } = parsed.data;

  const patch: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (locale !== undefined) patch.locale = locale;
  if (timezone !== undefined) patch.timezone = timezone;
  if (llmModel !== undefined) patch.llmModel = llmModel;
  if (notificationsEnabled !== undefined) {
    patch.notificationsEnabled = notificationsEnabled;
  }
  if (dateFormat !== undefined) patch.dateFormat = dateFormat;
  if (timeFormat !== undefined) patch.timeFormat = timeFormat;

  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning();

  if (!updated) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "not_found", message: "User not found" },
      },
      { status: 404 },
    );
  }

  const data: GetSettingsResponse = {
    locale: updated.locale === "tr" ? "tr" : "en",
    timezone: updated.timezone,
    llmModel: updated.llmModel,
    notificationsEnabled: updated.notificationsEnabled,
    dateFormat: updated.dateFormat as AllowedDateFormat,
    timeFormat: updated.timeFormat as AllowedTimeFormat,
  };

  return NextResponse.json({ ok: true, data });
}
