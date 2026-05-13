/**
 * Per-workspace 09:00-local daily digest push (Phase 16/#27).
 *
 * Runs once per UTC hour at minute :00 alongside the user-level
 * `daily-digest` cron. For each workspace where:
 *   - linked_telegram_chat_id IS NOT NULL  (bound to a group)
 *   - workspace owner's local hour is currently 9
 *   - last_daily_push_on != today in owner's TZ
 *
 * We compute the digest, render it via the shared `digest-format`
 * helper, post to the bound chat, and stamp `last_daily_push_on`.
 *
 * Empty digests still get the stamp (so we don't reprocess every
 * minute) but DON'T trigger a send — no noise.
 *
 * Send target: the default platform bot. White-label bots are
 * reminder-scoped per Phase 5 convention.
 */
import "server-only";

import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users, workspaces } from "@/lib/db/schema";
import { getBot } from "@/lib/server/bot";
import { pickLocale } from "@/lib/server/bot/i18n";
import { renderDailyDigest } from "@/lib/server/bot/digest-format";
import { getWorkspaceDailyDigest } from "@/lib/db/queries/workspace-digest";
import { env } from "@/lib/env";

const PICKUP_LIMIT = 100;

type DueWorkspace = {
  id: string;
  name: string;
  linkedChatId: number;
  ownerId: string;
  ownerLocale: string;
  ownerTimezone: string;
};

export async function dispatchWorkspaceDailyPush(): Promise<{
  picked: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const due = await pickEligibleWorkspaces();
  if (due.length === 0) {
    return { picked: 0, sent: 0, skipped: 0, failed: 0 };
  }

  let bot;
  try {
    bot = await getBot();
  } catch (err) {
    console.error("[workspace-daily-push] bot init failed", err);
    return { picked: due.length, sent: 0, skipped: 0, failed: due.length };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const ws of due) {
    try {
      const digest = await getWorkspaceDailyDigest({
        userId: ws.ownerId,
        workspaceId: ws.id,
        timezone: ws.ownerTimezone,
      });
      const isEmpty =
        digest.dueToday.length === 0 &&
        digest.overdue.length === 0 &&
        digest.assignedOpen.length === 0;

      // Always stamp first so a failed send doesn't get retried every
      // minute (we'd rather lose one day's digest than spam the chat).
      // The stamp is set to today's local date in owner's TZ.
      await stampPushedToday(ws.id, ws.ownerTimezone);

      if (isEmpty) {
        skipped++;
        continue;
      }

      const text = renderDailyDigest({
        digest,
        workspaceName: ws.name,
        timezone: ws.ownerTimezone,
        locale: pickLocale(ws.ownerLocale),
        botUsername: env.TELEGRAM_BOT_USERNAME,
      });

      await bot.api.sendMessage(ws.linkedChatId, text, {
        link_preview_options: { is_disabled: true },
      });
      sent++;
    } catch (err) {
      // Bot kicked from group? Group deleted? Workspace owner left?
      // We swallow per-workspace failures so one bad row doesn't block
      // the rest of the queue.
      console.error(
        "[workspace-daily-push] send failed",
        { workspaceId: ws.id, chatId: ws.linkedChatId, err: String(err) },
      );
      failed++;
    }
  }

  return { picked: due.length, sent, skipped, failed };
}

/**
 * Select workspaces ready for a push:
 *   - bound to a group
 *   - workspace owner's local hour currently == 9
 *   - last_daily_push_on != today in owner's TZ (or NULL)
 *
 * Both filters apply at SQL time via Postgres's AT TIME ZONE — saves
 * us pulling every bound workspace into memory.
 */
async function pickEligibleWorkspaces(): Promise<DueWorkspace[]> {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      linkedChatId: workspaces.linkedTelegramChatId,
      ownerId: workspaces.ownerId,
      ownerLocale: users.locale,
      ownerTimezone: users.timezone,
    })
    .from(workspaces)
    .innerJoin(users, eq(users.id, workspaces.ownerId))
    .where(
      and(
        isNotNull(workspaces.linkedTelegramChatId),
        isNull(workspaces.archivedAt),
        // owner-local hour == 9
        sql`EXTRACT(HOUR FROM (NOW() AT TIME ZONE ${users.timezone}))::int = 9`,
        // not yet pushed today in owner's TZ
        or(
          isNull(workspaces.lastDailyPushOn),
          ne(
            workspaces.lastDailyPushOn,
            sql<string>`(NOW() AT TIME ZONE ${users.timezone})::date`,
          ),
        ),
      ),
    )
    .limit(PICKUP_LIMIT);

  return rows
    .filter((r): r is DueWorkspace & { linkedChatId: number } =>
      r.linkedChatId !== null,
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      linkedChatId: r.linkedChatId,
      ownerId: r.ownerId,
      ownerLocale: r.ownerLocale,
      ownerTimezone: r.ownerTimezone,
    }));
}

async function stampPushedToday(
  workspaceId: string,
  ownerTimezone: string,
): Promise<void> {
  await db
    .update(workspaces)
    .set({
      lastDailyPushOn: sql`(NOW() AT TIME ZONE ${ownerTimezone})::date`,
    })
    .where(eq(workspaces.id, workspaceId));
}
