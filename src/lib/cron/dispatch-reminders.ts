/**
 * Reminder dispatcher (cron entry point — Phase 14d rewrite).
 *
 * Runs every 60 s in a Dokploy cron container. Pickup query rides on
 * the `item_reminders_due_idx` partial index:
 *
 *   WHERE item_reminders.remind_at <= NOW()
 *     AND item_reminders.sent = false
 *     AND items.archived_at IS NULL
 *
 * For each row: DM target via grammY, then conditional UPDATE on the
 * reminder row to flip `sent = true` ONLY on success (Inv-11
 * idempotency guard). When `recurrence_rule` is non-null, advance to
 * the next occurrence instead of marking permanently sent.
 *
 * Inv-12 defensive read: if the assignee was removed mid-cycle (no
 * matching `list_members` row), the LEFT JOIN yields a NULL
 * assignee_telegram_id and we fall back to the owner.
 *
 * Local testing: `npm run cron`.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  itemReminders,
  items,
  listMembers,
  lists,
  users,
} from "@/lib/db/schema";
import type { ItemReminderKind, ReminderJobItem } from "@/lib/types";
import { getBot, getBotById } from "@/lib/server/bot";
import { escapeMarkdownV2 } from "@/lib/server/bot/escape-markdown";
import { pickLocale } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/utils/format-date";
import type {
  AllowedDateFormat,
  AllowedTimeFormat,
} from "@/lib/validators/settings";

const PICKUP_LIMIT = 100;

/** Localized reminder body. Includes the deadline when distinct from the ping. */
function formatReminderBody(args: {
  locale: "tr" | "en";
  listEmoji: string | null;
  listName: string;
  itemText: string;
  remindAt: string;
  deadlineAt: string | null;
  timezone: string;
  dateFormat: AllowedDateFormat;
  timeFormat: AllowedTimeFormat;
}): string {
  const {
    locale,
    listEmoji,
    listName,
    itemText,
    remindAt,
    deadlineAt,
    timezone,
    dateFormat,
    timeFormat,
  } = args;
  const emoji = listEmoji ?? "📋";
  const heading = escapeMarkdownV2(`${emoji} ${listName}`);
  const item = escapeMarkdownV2(itemText);
  const remindLabel = formatDate(remindAt, {
    locale,
    timezone,
    dateFormat,
    timeFormat,
  });

  // Show the deadline only when it's set AND different from the
  // reminder time — for a default-on-deadline reminder they collapse
  // to one line.
  const deadlineDistinct =
    deadlineAt !== null && deadlineAt !== remindAt;
  const deadlineLabel = deadlineDistinct
    ? formatDate(deadlineAt, { locale, timezone, dateFormat, timeFormat })
    : null;

  if (locale === "tr") {
    const lines = [
      `*${heading}*`,
      "",
      `⏰ Hatırlatma: *${item}*`,
      escapeMarkdownV2(remindLabel),
    ];
    if (deadlineLabel !== null) {
      lines.push(escapeMarkdownV2(`Son tarih: ${deadlineLabel}`));
    }
    return lines.join("\n");
  }
  const lines = [
    `*${heading}*`,
    "",
    `⏰ Reminder: *${item}*`,
    escapeMarkdownV2(remindLabel),
  ];
  if (deadlineLabel !== null) {
    lines.push(escapeMarkdownV2(`Deadline: ${deadlineLabel}`));
  }
  return lines.join("\n");
}

/**
 * Internal augmented job shape carried through the dispatch loop. The
 * public `ReminderJobItem` (frozen by Architect) stays minimal; this
 * type adds the display fields the dispatcher needs to compose a body
 * without re-fetching.
 */
type ReminderJob = ReminderJobItem & {
  listName: string;
  listEmoji: string | null;
  /**
   * Phase 5 multi-bot: the workspace's primary white-label bot ID
   * (when registered). Reminder dispatch routes via this bot if
   * present; falls back to the default platform bot otherwise.
   */
  workspaceBotId: string | null;
  /**
   * Phase 14c display preferences — pulled from the DM target's
   * `users` row (assignee if present, else owner).
   */
  ownerDateFormat: AllowedDateFormat;
  ownerTimeFormat: AllowedTimeFormat;
  assigneeDateFormat: AllowedDateFormat | null;
  assigneeTimeFormat: AllowedTimeFormat | null;
};

async function pickDueItems(): Promise<ReminderJob[]> {
  // Phase 14d: pickup is item_reminders → items → lists → owner +
  // (LEFT JOIN) assignee + (LEFT JOIN) primary white-label bot. The
  // partial index `item_reminders_due_idx` covers the predicate.
  const rows = await db
    .select({
      reminderId: itemReminders.id,
      itemId: items.id,
      listId: items.listId,
      text: items.text,
      remindAt: itemReminders.remindAt,
      deadlineAt: items.deadlineAt,
      kind: itemReminders.kind,
      offsetMinutes: itemReminders.offsetMinutes,
      recurrenceRule: itemReminders.recurrenceRule,
      ownerTelegramId: sql<number>`owner.telegram_id`.as("owner_telegram_id"),
      ownerLocale: sql<string>`owner.locale`.as("owner_locale"),
      ownerTimezone: sql<string>`owner.timezone`.as("owner_timezone"),
      ownerDateFormat: sql<string>`owner.date_format`.as("owner_date_format"),
      ownerTimeFormat: sql<string>`owner.time_format`.as("owner_time_format"),
      assigneeTelegramId: sql<number | null>`assignee.telegram_id`.as(
        "assignee_telegram_id",
      ),
      assigneeLocale: sql<string | null>`assignee.locale`.as("assignee_locale"),
      assigneeTimezone: sql<string | null>`assignee.timezone`.as(
        "assignee_timezone",
      ),
      assigneeDateFormat: sql<string | null>`assignee.date_format`.as(
        "assignee_date_format",
      ),
      assigneeTimeFormat: sql<string | null>`assignee.time_format`.as(
        "assignee_time_format",
      ),
      listName: lists.name,
      listEmoji: lists.emoji,
      workspaceBotId: sql<string | null>`primary_bot.id`.as(
        "primary_bot_id",
      ),
    })
    .from(itemReminders)
    .innerJoin(items, sql`${items.id} = ${itemReminders.itemId}`)
    .innerJoin(lists, sql`${lists.id} = ${items.listId}`)
    .innerJoin(
      sql`${users} AS owner`,
      sql`owner.id = ${lists.ownerId}`,
    )
    .leftJoin(
      sql`${listMembers} AS lm`,
      sql`lm.list_id = ${items.listId} AND lm.user_id = ${items.assigneeId}`,
    )
    .leftJoin(sql`${users} AS assignee`, sql`assignee.id = lm.user_id`)
    .leftJoin(
      sql`workspace_bots AS wb`,
      sql`wb.workspace_id = ${lists.workspaceId} AND wb.is_primary = true`,
    )
    .leftJoin(
      sql`bots AS primary_bot`,
      sql`primary_bot.id = wb.bot_id AND primary_bot.is_default = false`,
    )
    .where(
      sql`${itemReminders.remindAt} <= now()
          AND ${itemReminders.sent} = false
          AND ${items.archivedAt} IS NULL`,
    )
    .limit(PICKUP_LIMIT);

  return rows.map<ReminderJob>((r) => ({
    reminderId: r.reminderId,
    itemId: r.itemId,
    listId: r.listId,
    text: r.text,
    remindAt: r.remindAt.toISOString(),
    deadlineAt: r.deadlineAt ? r.deadlineAt.toISOString() : null,
    kind: r.kind as ItemReminderKind,
    offsetMinutes: r.offsetMinutes,
    recurrenceRule: r.recurrenceRule,
    ownerTelegramId: r.ownerTelegramId,
    ownerLocale: r.ownerLocale,
    ownerTimezone: r.ownerTimezone,
    assigneeTelegramId: r.assigneeTelegramId,
    assigneeLocale: r.assigneeLocale,
    assigneeTimezone: r.assigneeTimezone,
    listName: r.listName,
    listEmoji: r.listEmoji,
    workspaceBotId: r.workspaceBotId,
    ownerDateFormat: (r.ownerDateFormat as AllowedDateFormat) ?? "DD.MM.YYYY",
    ownerTimeFormat: (r.ownerTimeFormat as AllowedTimeFormat) ?? "24h",
    assigneeDateFormat:
      (r.assigneeDateFormat as AllowedDateFormat | null) ?? null,
    assigneeTimeFormat:
      (r.assigneeTimeFormat as AllowedTimeFormat | null) ?? null,
  }));
}

/**
 * Conditional UPDATE: only flip sent=true if it's still false.
 * Idempotency guard for retries (Inv-11) at the reminder-row level.
 */
async function markReminderSent(reminderId: string): Promise<void> {
  await db
    .update(itemReminders)
    .set({ sent: true, lastSentAt: new Date(), updatedAt: new Date() })
    .where(
      sql`${itemReminders.id} = ${reminderId} AND ${itemReminders.sent} = false`,
    );
}

/**
 * Recurring reminder advancement (absolute kind only). When a reminder
 * fires for a row whose `recurrence_rule` is non-null, we re-arm it
 * for the next occurrence instead of marking it permanently sent.
 * Computed in UTC — see schema docstring for the timezone caveat.
 *
 * If the rule yields no future occurrence (e.g. UNTIL or COUNT
 * exhausted) we fall back to the one-shot path: mark sent + clear
 * recurrence_rule so the audit trail reflects the natural end.
 */
async function advanceRecurringReminder(
  reminderId: string,
  currentRemindAt: string,
  recurrenceRule: string,
): Promise<{ advanced: boolean; nextRemindAt: Date | null }> {
  const { RRule } = await import("rrule");
  let nextRemindAt: Date | null = null;
  try {
    const rule = RRule.fromString(`RRULE:${recurrenceRule}`);
    nextRemindAt = rule.after(new Date(currentRemindAt), false);
  } catch (error) {
    console.error("[reminder] invalid RRULE — clearing", {
      reminderId,
      recurrenceRule,
      error: String(error),
    });
  }

  if (!nextRemindAt) {
    await db
      .update(itemReminders)
      .set({
        sent: true,
        lastSentAt: new Date(),
        recurrenceRule: null,
        updatedAt: new Date(),
      })
      .where(
        sql`${itemReminders.id} = ${reminderId} AND ${itemReminders.sent} = false`,
      );
    return { advanced: false, nextRemindAt: null };
  }

  await db
    .update(itemReminders)
    .set({
      remindAt: nextRemindAt,
      sent: false,
      lastSentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      sql`${itemReminders.id} = ${reminderId} AND ${itemReminders.sent} = false`,
    );
  return { advanced: true, nextRemindAt };
}

export async function dispatchReminders(): Promise<{
  picked: number;
  sent: number;
  failed: number;
}> {
  const due = await pickDueItems();
  if (due.length === 0) {
    await detectPersistentFailures();
    return { picked: 0, sent: 0, failed: 0 };
  }

  const defaultBot = await getBot();
  let sent = 0;
  let failed = 0;

  for (const job of due) {
    const targetTelegramId = job.assigneeTelegramId ?? job.ownerTelegramId;
    const targetLocale = pickLocale(job.assigneeLocale ?? job.ownerLocale);
    const targetTimezone = job.assigneeTimezone ?? job.ownerTimezone ?? "UTC";
    const targetDateFormat = job.assigneeDateFormat ?? job.ownerDateFormat;
    const targetTimeFormat = job.assigneeTimeFormat ?? job.ownerTimeFormat;

    if (!targetTelegramId) {
      console.error(
        "[cron/dispatch-reminders] no telegram target for reminder",
        { reminderId: job.reminderId, itemId: job.itemId, listId: job.listId },
      );
      failed += 1;
      continue;
    }

    const body = formatReminderBody({
      locale: targetLocale,
      listEmoji: job.listEmoji,
      listName: job.listName,
      itemText: job.text,
      remindAt: job.remindAt,
      deadlineAt: job.deadlineAt,
      timezone: targetTimezone,
      dateFormat: targetDateFormat,
      timeFormat: targetTimeFormat,
    });

    let primaryBot = defaultBot;
    if (job.workspaceBotId) {
      const wsBot = await getBotById(job.workspaceBotId);
      if (wsBot) primaryBot = wsBot;
    }

    let delivered = false;
    try {
      await primaryBot.api.sendMessage(targetTelegramId, body, {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      });
      delivered = true;
    } catch (error) {
      if (primaryBot !== defaultBot) {
        try {
          await defaultBot.api.sendMessage(targetTelegramId, body, {
            parse_mode: "MarkdownV2",
            link_preview_options: { is_disabled: true },
          });
          delivered = true;
          console.log(
            "[cron/dispatch-reminders] white-label bot fallback to default",
            { reminderId: job.reminderId, workspaceBotId: job.workspaceBotId },
          );
        } catch (fallbackError) {
          console.error(
            "[cron/dispatch-reminders] both white-label + default failed",
            {
              reminderId: job.reminderId,
              primaryError: String(error),
              fallbackError: String(fallbackError),
            },
          );
        }
      } else {
        console.error(
          "[cron/dispatch-reminders] sendMessage failed; will retry next tick",
          { reminderId: job.reminderId, error: String(error) },
        );
      }
    }

    if (delivered) {
      // Recurrence is only allowed for kind='absolute' — guarded by
      // the CHECK constraint. before_deadline reminders never advance.
      if (job.recurrenceRule && job.kind === "absolute") {
        await advanceRecurringReminder(
          job.reminderId,
          job.remindAt,
          job.recurrenceRule,
        );
      } else {
        await markReminderSent(job.reminderId);
      }
      sent += 1;
    } else {
      failed += 1;
    }
  }

  await detectPersistentFailures();

  return { picked: due.length, sent, failed };
}

/**
 * Inv-15: identify reminders whose `remind_at` is >5 minutes in the
 * past and still have `sent = false`. Each row gets a single
 * `reminder_send_persistent_failure` warning log entry. Capped at 50
 * to avoid log flood when a bot token has been revoked. Detection is
 * purely observability — no DB writes, no exceptions thrown.
 */
async function detectPersistentFailures(): Promise<void> {
  try {
    const stuck = await db
      .select({
        reminderId: itemReminders.id,
        itemId: itemReminders.itemId,
        remindAt: itemReminders.remindAt,
      })
      .from(itemReminders)
      .innerJoin(items, sql`${items.id} = ${itemReminders.itemId}`)
      .where(
        sql`${itemReminders.remindAt} < (now() - interval '5 minutes')
            AND ${itemReminders.sent} = false
            AND ${items.archivedAt} IS NULL`,
      )
      .limit(50);

    for (const row of stuck) {
      console.warn(
        "[cron/dispatch-reminders] reminder_send_persistent_failure",
        {
          reminderId: row.reminderId,
          itemId: row.itemId,
          remindAt: row.remindAt ? row.remindAt.toISOString() : null,
        },
      );
    }
  } catch (error) {
    console.error(
      "[cron/dispatch-reminders] persistent-failure detection threw",
      error,
    );
  }
}

/**
 * Liveness ping — fires whenever the dispatcher loop completes without
 * throwing, regardless of per-row delivery success. Phase 4 · P2-3.
 */
async function maybePingHeartbeat(): Promise<void> {
  const url = env.LISTBULL_HEARTBEAT_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "GET" });
  } catch {
    // Heartbeat is monitoring, never load-bearing. Swallow.
  }
}

async function main(): Promise<void> {
  try {
    const result = await dispatchReminders();
    console.log("[cron/dispatch-reminders]", result);
  } catch (error) {
    console.error("[cron/dispatch-reminders] unrecoverable", error);
    process.exitCode = 1;
    return;
  }
  // Phase 15: 09:00 daily digest. Run once per UTC hour at minute :00
  // (cron tick fires every 60s, so up to 60 ticks may match; the
  // pickup query filters down to users whose local hour is currently
  // 9 AND who haven't received today's digest yet, which limits the
  // re-evaluation cost to a few SQL ops). We gate at minute < 1 to
  // avoid running the SELECT 60 times per hour.
  if (new Date().getUTCMinutes() < 1) {
    try {
      const { dispatchDailyDigest } = await import("./daily-digest");
      const result = await dispatchDailyDigest();
      if (result.picked > 0) {
        console.log("[cron/daily-digest]", result);
      }
    } catch (error) {
      console.error("[cron/daily-digest] threw", error);
    }

    // Phase 16/#27: workspace-level daily push (group-bound only).
    // Same hour-top gate as user digest; cron loop runs every 60 s
    // and dispatch picks workspaces where owner-local hour == 9.
    try {
      const { dispatchWorkspaceDailyPush } = await import(
        "./workspace-daily-push"
      );
      const result = await dispatchWorkspaceDailyPush();
      if (result.picked > 0) {
        console.log("[cron/workspace-daily-push]", result);
      }
    } catch (error) {
      console.error("[cron/workspace-daily-push] threw", error);
    }
  }

  await maybePingHeartbeat();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
      console.error("[cron/dispatch-reminders] fatal", error);
      process.exit(1);
    });
}
