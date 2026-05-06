/**
 * Mini App settings API — GET /api/settings (read prefs + redacted BYOK
 * preview), PATCH /api/settings (mutate any subset of fields).
 *
 * BYOK key NEVER leaves the server in plaintext. GET returns
 * `byokKeyPreview` (last 4 chars) only; the full plaintext only ever
 * lives ephemerally in `respond.ts` after server-side decryption.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { decrypt, encrypt, redactKey } from "@/lib/server/encryption";
import {
  patchSettingsBodySchema,
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

  let byokKeyPreview: string | null = null;
  if (user.openrouterApiKeyEncrypted) {
    try {
      const plaintext = decrypt(user.openrouterApiKeyEncrypted);
      byokKeyPreview = redactKey(plaintext);
    } catch {
      // Stored ciphertext can't be decrypted (env key rotation, etc.).
      // Treat as "no key" — UI prompts re-entry.
      byokKeyPreview = null;
    }
  }

  const data: GetSettingsResponse = {
    locale: user.locale === "tr" ? "tr" : "en",
    timezone: user.timezone,
    llmModel: user.llmModel,
    notificationsEnabled: user.notificationsEnabled,
    hasApiKey: !!user.openrouterApiKeyEncrypted,
    byokKeyPreview,
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
    openrouterApiKey,
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
  if (openrouterApiKey !== undefined) {
    if (openrouterApiKey === "") {
      patch.openrouterApiKeyEncrypted = null;
    } else {
      patch.openrouterApiKeyEncrypted = encrypt(openrouterApiKey);
    }
  }

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

  let byokKeyPreview: string | null = null;
  if (updated.openrouterApiKeyEncrypted) {
    try {
      const plaintext = decrypt(updated.openrouterApiKeyEncrypted);
      byokKeyPreview = redactKey(plaintext);
    } catch {
      byokKeyPreview = null;
    }
  }

  const data: GetSettingsResponse = {
    locale: updated.locale === "tr" ? "tr" : "en",
    timezone: updated.timezone,
    llmModel: updated.llmModel,
    notificationsEnabled: updated.notificationsEnabled,
    hasApiKey: !!updated.openrouterApiKeyEncrypted,
    byokKeyPreview,
  };

  return NextResponse.json({ ok: true, data });
}
