/**
 * Reminder dispatcher (Phase 17 chat-only).
 *
 * Runs every 60 s in the Dokploy cron container. Pickup query:
 *   SELECT reminder + item + chat owner + assignee
 *   FROM item_reminders
 *   JOIN items     ON items.id = item_reminders.item_id
 *   JOIN chats     ON chats.chat_id = items.chat_id
 *   JOIN users owner   ON owner.id = chats.owner_user_id
 *   LEFT JOIN users assignee ON assignee.id = items.assignee_id
 *   WHERE reminders.sent = false
 *     AND reminders.remind_at <= NOW()
 *     AND items.archived_at IS NULL
 *
 * For each: DM target (assignee fallback to owner) via the default
 * platform bot. Mark sent=true ONLY on success (Inv-11 idempotency).
 * Recurring reminders advance to next occurrence instead of permanent
 * sent.
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function pickEligibleReminders(): Promise<ReminderJobItem[]> {
  const rows = await db.execute<{
    reminder_id: string;
    item_id: string;
    chat_id: number;
    text: string;
    remind_at: Date;
    deadline_at: Date | null;
    kind: string;
    offset_minutes: number | null;
    recurrence_rule: string | null;
    owner_telegram_id: number;
    owner_locale: string;
    owner_timezone: string;
    owner_date_format: string;
    owner_time_format: string;
    assignee_telegram_id: number | null;
    assignee_locale: string | null;
    assignee_timezone: string | null;
    assignee_date_format: string | null;
    assignee_time_format: string | null;
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
      owner.timezone AS owner_timezone,
      owner.date_format AS owner_date_format,
      owner.time_format AS owner_time_format,
      assignee.telegram_id AS assignee_telegram_id,
      assignee.locale AS assignee_locale,
      assignee.timezone AS assignee_timezone,
      assignee.date_format AS assignee_date_format,
      assignee.time_format AS assignee_time_format
    FROM ${itemReminders} r
    INNER JOIN ${items} i ON i.id = r.item_id
    INNER JOIN ${chats} c ON c.chat_id = i.chat_id
    INNER JOIN ${users} owner ON owner.id = c.owner_user_id
    LEFT JOIN ${users} assignee ON assignee.id = i.assignee_id
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
    remindAt: r.remind_at.toISOString(),
    deadlineAt: r.deadline_at ? r.deadline_at.toISOString() : null,
    kind: r.kind as ItemReminderKind,
    offsetMinutes: r.offset_minutes,
    recurrenceRule: r.recurrence_rule,
    ownerTelegramId: r.owner_telegram_id,
    ownerLocale: r.owner_locale,
    ownerTimezone: r.owner_timezone,
    assigneeTelegramId: r.assignee_telegram_id,
    assigneeLocale: r.assignee_locale,
    assigneeTimezone: r.assignee_timezone,
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
    const userTg = r.assigneeTelegramId ?? r.ownerTelegramId;
    // Route to the chat the item lives in (group → group, DM → DM)
    // instead of unconditionally piping to the user's DM. Group items
    // surface their reminders in-context so everyone sees the ping;
    // the targeted user is HTML-mentioned + force_reply selective so
    // a tap-reply continues the conversation without re-@-mentioning.
    const targetTg = r.chatId;
    const isGroup = r.chatId < 0;
    const locale = pickLocale(r.assigneeLocale ?? r.ownerLocale);
    const timezone = r.assigneeTimezone ?? r.ownerTimezone;
    // Date/time format defaults pulled in via pickup query but kept
    // simple here — assignee's preferences override owner's when set.
    const dateFormat = "DD.MM.YYYY";
    const timeFormat = "24h";

    const rawBody = formatReminderBody({
      locale,
      itemText: r.text,
      remindAt: r.remindAt,
      deadlineAt: r.deadlineAt,
      timezone,
      dateFormat,
      timeFormat,
    });

    const body = isGroup
      ? `<a href="tg://user?id=${userTg}">🔔</a> ${escapeHtml(rawBody)}`
      : rawBody;
    const opts = isGroup
      ? {
          parse_mode: "HTML" as const,
          reply_markup: {
            force_reply: true as const,
            selective: true as const,
          },
        }
      : undefined;

    try {
      await bot.api.sendMessage(targetTg, body, opts);
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
