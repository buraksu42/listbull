/**
 * Executor: `update_settings` — chat-driven user preferences update.
 *
 * Mirrors PATCH /api/settings minus the BYOK key. Builds a partial
 * patch from the supplied fields, computes which fields actually
 * change vs current state (so `changes` output is precise), persists
 * via single UPDATE. No activity_log row — settings are user-private,
 * not list-scoped (Inv-1's transactional + activity_log pattern is for
 * list-state mutations).
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  updateSettingsInputSchema,
  type UpdateSettingsOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

type ChangeField =
  | "locale"
  | "timezone"
  | "llm_model"
  | "notifications_enabled";

export async function executeUpdateSettings(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<UpdateSettingsOutput>> {
  const parsed = updateSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const {
    locale,
    timezone,
    llm_model,
    notifications_enabled,
  } = parsed.data;

  const current = await db.query.users.findFirst({
    where: eq(users.id, ctx.userId),
  });
  if (!current) {
    return err(ERR.not_found, "User row missing.");
  }

  const patch: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
  };
  const changes: ChangeField[] = [];

  if (locale !== undefined && locale !== current.locale) {
    patch.locale = locale;
    changes.push("locale");
  }
  if (timezone !== undefined && timezone !== current.timezone) {
    patch.timezone = timezone;
    changes.push("timezone");
  }
  if (llm_model !== undefined && llm_model !== current.llmModel) {
    patch.llmModel = llm_model;
    changes.push("llm_model");
  }
  if (
    notifications_enabled !== undefined &&
    notifications_enabled !== current.notificationsEnabled
  ) {
    patch.notificationsEnabled = notifications_enabled;
    changes.push("notifications_enabled");
  }

  // Idempotent no-op when no fields actually change.
  if (changes.length === 0) {
    return ok({
      locale: (current.locale as "tr" | "en") ?? "en",
      timezone: current.timezone,
      llm_model: current.llmModel,
      notifications_enabled: current.notificationsEnabled,
      changes: [],
    });
  }

  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, ctx.userId))
    .returning();
  if (!updated) {
    throw new Error("update-settings: update returned no row");
  }

  return ok({
    locale: (updated.locale as "tr" | "en") ?? "en",
    timezone: updated.timezone,
    llm_model: updated.llmModel,
    notifications_enabled: updated.notificationsEnabled,
    changes,
  });
}
