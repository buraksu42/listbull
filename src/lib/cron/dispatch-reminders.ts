/**
 * Reminder dispatcher (Phase 17 chat-only).
 *
 * Runs every 60 s in the Dokploy cron container. Pickup query:
 *   SELECT reminder + item + chat owner
 *   FROM item_reminders
 *   JOIN items   ON items.id = item_reminders.item_id
 *   JOIN chats   ON chats.chat_id = items.chat_id
 *   JOIN users owner ON owner.id = chats.owner_user_id
 *   WHERE reminders.sent = false
 *     AND reminders.remind_at <= NOW()
 *     AND items.archived_at IS NULL
 *
 * Each reminder fires in the item's own chat (`items.chat_id`): a
 * group item's reminder lands in the group, a DM item's in the DM.
 * Owner locale/timezone format the body. Mark sent=true ONLY on
 * success (Inv-11 idempotency). Recurring reminders advance to the
 * next occurrence instead of a permanent sent.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  chats,
  itemReminders,
  items,
  users,
} from "@/lib/db/schema";
import type { ItemReminderKind, ReminderJobItem } from "@/lib/types";
import { getBot } from "@/lib/server/bot";
import { pickLocale } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/utils/format-date";

const PICKUP_LIMIT = 100;

function formatReminderBody(args: {
  locale: "tr" | "en";
  itemText: string;
  remindAt: string;
  deadlineAt: string | null;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
}): string {
  const { locale, itemText, remindAt, deadlineAt, timezone, dateFormat, timeFormat } =
    args;
  const remind = formatDate(remindAt, {
    timezone,
    dateFormat: dateFormat as "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",
    timeFormat: timeFormat as "24h" | "12h",
    locale,
  });
  const lines = [
    locale === "tr"
      ? `⏰ Hatırlatma: ${itemText}`
      : `⏰ Reminder: ${itemText}`,
    locale === "tr" ? `Zaman: ${remind}` : `Time: ${remind}`,
  ];
  if (deadlineAt && deadlineAt !== remindAt) {
    const due = formatDate(deadlineAt, {
      timezone,
      dateFormat: dateFormat as "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",
      timeFormat: timeFormat as "24h" | "12h",
      locale,
    });
    lines.push(locale === "tr" ? `Son tarih: ${due}` : `Due: ${due}`);
  }
  return lines.join("\n");
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

async function pickEligibleReminders(): Promise<ReminderJobItem[]> {
  const rows = await db.execute<{
    reminder_id: string;
    item_id: string;
    chat_id: number;
    text: string;
    // postgres-js returns timestamptz as strings, not Date objects.
    // Coerce below before any .toISOString() call.
    remind_at: Date | string;
    deadline_at: Date | string | null;
    kind: string;
    offset_minutes: number | null;
    recurrence_rule: string | null;
    owner_telegram_id: number;
    owner_locale: string;
    owner_timezone: string;
  }>(sql`
    SELECT
      r.id AS reminder_id,
      r.item_id,
      i.chat_id,
      i.text,
      r.remind_at,
      i.deadline_at,
      r.kind,
      r.offset_minutes,
      r.recurrence_rule,
      owner.telegram_id AS owner_telegram_id,
      owner.locale AS owner_locale,
      owner.timezone AS owner_timezone
    FROM ${itemReminders} r
    INNER JOIN ${items} i ON i.id = r.item_id
    INNER JOIN ${chats} c ON c.chat_id = i.chat_id
    INNER JOIN ${users} owner ON owner.id = c.owner_user_id
    WHERE r.sent = false
      AND r.remind_at <= NOW()
      AND i.archived_at IS NULL
    ORDER BY r.remind_at ASC
    LIMIT ${PICKUP_LIMIT}
  `);

  return rows.map((r) => ({
    reminderId: r.reminder_id,
    itemId: r.item_id,
    chatId: r.chat_id,
    text: r.text,
    remindAt: toIso(r.remind_at),
    deadlineAt: r.deadline_at ? toIso(r.deadline_at) : null,
    kind: r.kind as ItemReminderKind,
    offsetMinutes: r.offset_minutes,
    recurrenceRule: r.recurrence_rule,
    ownerTelegramId: r.owner_telegram_id,
    ownerLocale: r.owner_locale,
    ownerTimezone: r.owner_timezone,
  }));
}

export async function dispatchReminders(): Promise<{
  picked: number;
  sent: number;
  failed: number;
}> {
  const picked = await pickEligibleReminders();
  if (picked.length === 0) return { picked: 0, sent: 0, failed: 0 };

  const bot = await getBot();
  let sent = 0;
  let failed = 0;

  for (const r of picked) {
    // Route to the item's own chat: a group item's reminder fires in
    // the GROUP (everyone sees it); a DM item's reminder fires in the
    // DM. For DM items r.chatId already equals the owner's Telegram
    // id, so this is a no-op there.
    const targetTg = r.chatId;
    const locale = pickLocale(r.ownerLocale);
    const timezone = r.ownerTimezone;
    const dateFormat = "DD.MM.YYYY";
    const timeFormat = "24h";

    const body = formatReminderBody({
      locale,
      itemText: r.text,
      remindAt: r.remindAt,
      deadlineAt: r.deadlineAt,
      timezone,
      dateFormat,
      timeFormat,
    });

    try {
      await bot.api.sendMessage(targetTg, body);
      await db.execute(sql`
        UPDATE item_reminders
           SET sent = true, sent_at = NOW()
         WHERE id = ${r.reminderId}
      `);
      sent++;
    } catch (e) {
      console.error("[dispatch-reminders] send failed", {
        reminderId: r.reminderId,
        targetTg,
        err: String(e),
      });
      failed++;
    }
  }

  // silence unused env import; remains live for downstream config branches
  void env;
  return { picked: picked.length, sent, failed };
}

async function maybePingHeartbeat(): Promise<void> {
  // Healthchecks heartbeat is configured per-deployment env;
  // intentional no-op when unset.
  const url = process.env.LISTBULL_REMINDERS_HEARTBEAT_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "GET" });
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  try {
    const result = await dispatchReminders();
    if (result.picked > 0) {
      console.log("[cron/dispatch-reminders]", result);
    }
  } catch (error) {
    console.error("[cron/dispatch-reminders] unrecoverable", error);
    process.exitCode = 1;
    return;
  }

  // Every-tick: sweep pending secret deletions (M5 — restart-safe
  // floor for reveal_secret's 15s in-process timer). Cheap when
  // empty; doesn't gate other hour-top jobs.
  try {
    const { dispatchPendingSecretDeletions } = await import(
      "./sweep-pending-deletions"
    );
    const result = await dispatchPendingSecretDeletions();
    if (result.picked > 0) {
      console.log("[cron/sweep-pending-deletions]", result);
    }
  } catch (e) {
    console.error("[cron/sweep-pending-deletions] threw", e);
  }

  // Hour-top jobs: daily digest + per-chat 09:00 push.
  if (new Date().getUTCMinutes() < 1) {
    try {
      const { dispatchDailyDigest } = await import("./daily-digest");
      const result = await dispatchDailyDigest();
      if (result.picked > 0) console.log("[cron/daily-digest]", result);
    } catch (e) {
      console.error("[cron/daily-digest] threw", e);
    }
    try {
      const { dispatchChatDailyPush } = await import("./chat-daily-push");
      const result = await dispatchChatDailyPush();
      if (result.picked > 0) console.log("[cron/chat-daily-push]", result);
    } catch (e) {
      console.error("[cron/chat-daily-push] threw", e);
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
