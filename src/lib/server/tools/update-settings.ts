/**
 * Executor: `update_settings` (Phase 17 — user-level prefs, unchanged
 * from pre-pivot except cleanup of workspace references).
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

export async function executeUpdateSettings(
  input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<UpdateSettingsOutput>> {
  const parsed = updateSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const data = parsed.data;
  void ctx; // chatId not needed for user-level prefs

  const [current] = await db
    .select()
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);
  if (!current) return err(ERR.not_found, "User not found.");

  const changes: Array<
    | "locale"
    | "timezone"
    | "llm_model"
    | "notifications_enabled"
    | "date_format"
    | "time_format"
  > = [];
  const patch: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.locale !== undefined && data.locale !== current.locale) {
    patch.locale = data.locale;
    changes.push("locale");
  }
  if (data.timezone !== undefined && data.timezone !== current.timezone) {
    patch.timezone = data.timezone;
    changes.push("timezone");
  }
  if (data.llm_model !== undefined && data.llm_model !== current.llmModel) {
    patch.llmModel = data.llm_model;
    changes.push("llm_model");
  }
  if (
    data.notifications_enabled !== undefined &&
    data.notifications_enabled !== current.notificationsEnabled
  ) {
    patch.notificationsEnabled = data.notifications_enabled;
    changes.push("notifications_enabled");
  }
  if (
    data.date_format !== undefined &&
    data.date_format !== current.dateFormat
  ) {
    patch.dateFormat = data.date_format;
    changes.push("date_format");
  }
  if (
    data.time_format !== undefined &&
    data.time_format !== current.timeFormat
  ) {
    patch.timeFormat = data.time_format;
    changes.push("time_format");
  }

  if (changes.length === 0) {
    return ok({
      locale: current.locale as "tr" | "en",
      timezone: current.timezone,
      llm_model: current.llmModel,
      notifications_enabled: current.notificationsEnabled,
      date_format: current.dateFormat as "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",
      time_format: current.timeFormat as "24h" | "12h",
      changes: [],
    });
  }

  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, ctx.userId))
    .returning();
  if (!updated) throw new Error("update-settings: update returned no row");

  return ok({
    locale: updated.locale as "tr" | "en",
    timezone: updated.timezone,
    llm_model: updated.llmModel,
    notifications_enabled: updated.notificationsEnabled,
    date_format: updated.dateFormat as "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",
    time_format: updated.timeFormat as "24h" | "12h",
    changes,
  });
}
