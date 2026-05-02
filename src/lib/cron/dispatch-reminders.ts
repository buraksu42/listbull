/**
 * Reminder dispatcher (Phase 3 cron entry point).
 *
 * Runs every 60 s in a Dokploy cron container. Pickup query rides on
 * the existing `items_due_at_idx` partial index (Phase 1):
 *
 *   WHERE due_at <= NOW()
 *     AND reminder_sent = false
 *     AND archived_at IS NULL
 *
 * For each row: DM target via grammY, then conditional UPDATE to flip
 * `reminder_sent = true` ONLY on success (Inv-11 idempotency guard).
 *
 * Inv-12 defensive read: if the assignee was removed mid-cycle (no
 * matching `list_members` row), the LEFT JOIN yields a NULL
 * assignee_telegram_id and we fall back to the owner.
 *
 * Local testing: `npm run cron`.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  items,
  listMembers,
  lists,
  users,
} from "@/lib/db/schema";
import type { ReminderJobItem } from "@/lib/types";
import { getBot } from "@/lib/server/bot";
import { escapeMarkdownV2 } from "@/lib/server/bot/escape-markdown";
import { pickLocale } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";

const PICKUP_LIMIT = 100;

/** Localized reminder body. Kept inline so this file is self-contained. */
function formatReminderBody(args: {
  locale: "tr" | "en";
  listEmoji: string | null;
  listName: string;
  itemText: string;
  dueAt: string; // ISO 8601
  timezone: string;
}): string {
  const { locale, listEmoji, listName, itemText, dueAt, timezone } = args;
  const emoji = listEmoji ?? "📋";
  const heading = escapeMarkdownV2(`${emoji} ${listName}`);
  const item = escapeMarkdownV2(itemText);
  const dueLabel = formatLocalTime(dueAt, timezone, locale);
  if (locale === "tr") {
    return (
      `*${heading}*\n\n` +
      `⏰ Hatırlatma: *${item}*\n` +
      `${escapeMarkdownV2(dueLabel)}`
    );
  }
  return (
    `*${heading}*\n\n` +
    `⏰ Reminder: *${item}*\n` +
    `${escapeMarkdownV2(dueLabel)}`
  );
}

function formatLocalTime(
  iso: string,
  timezone: string,
  locale: "tr" | "en",
): string {
  try {
    const fmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "UTC",
    });
    return fmt.format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

/**
 * Internal augmented job shape carried through the dispatch loop. The
 * public `ReminderJobItem` (frozen by Architect) stays minimal; this
 * type adds the display fields the dispatcher needs to compose a body
 * without re-fetching.
 */
type ReminderJob = ReminderJobItem & {
  ownerTimezone: string;
  assigneeTimezone: string | null;
  listName: string;
  listEmoji: string | null;
};

async function pickDueItems(): Promise<ReminderJob[]> {
  // Use a raw SQL JOIN matching the contract; Drizzle's relational query
  // builder doesn't have an obvious "LEFT JOIN scoped on (list_id,
  // user_id)" shape that lines up cleanly with the index.
  //
  // Inv-12 defensive read: assignee LEFT JOIN goes through list_members
  // first, so a stale assignee_id (user removed from list) yields
  // NULL → fall back to owner.
  const rows = await db
    .select({
      itemId: items.id,
      listId: items.listId,
      text: items.text,
      dueAt: items.dueAt,
      ownerTelegramId: sql<number>`owner.telegram_id`.as("owner_telegram_id"),
      ownerLocale: sql<string>`owner.locale`.as("owner_locale"),
      ownerTimezone: sql<string>`owner.timezone`.as("owner_timezone"),
      assigneeTelegramId: sql<number | null>`assignee.telegram_id`.as(
        "assignee_telegram_id",
      ),
      assigneeLocale: sql<string | null>`assignee.locale`.as("assignee_locale"),
      assigneeTimezone: sql<string | null>`assignee.timezone`.as(
        "assignee_timezone",
      ),
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(
      sql`${users} AS owner`,
      sql`owner.id = ${lists.ownerId}`,
    )
    .leftJoin(
      sql`${listMembers} AS lm`,
      sql`lm.list_id = ${items.listId} AND lm.user_id = ${items.assigneeId}`,
    )
    .leftJoin(sql`${users} AS assignee`, sql`assignee.id = lm.user_id`)
    .where(
      sql`${items.dueAt} <= now()
          AND ${items.reminderSent} = false
          AND ${items.archivedAt} IS NULL`,
    )
    .limit(PICKUP_LIMIT);

  return rows
    .filter((r): r is typeof r & { dueAt: Date } => r.dueAt !== null)
    .map<ReminderJob>((r) => ({
      itemId: r.itemId,
      listId: r.listId,
      text: r.text,
      dueAt: r.dueAt.toISOString(),
      ownerTelegramId: r.ownerTelegramId,
      ownerLocale: r.ownerLocale,
      assigneeTelegramId: r.assigneeTelegramId,
      assigneeLocale: r.assigneeLocale,
      ownerTimezone: r.ownerTimezone,
      assigneeTimezone: r.assigneeTimezone,
      listName: r.listName,
      listEmoji: r.listEmoji,
    }));
}

/** Conditional UPDATE: only flip reminder_sent if it's still false. */
async function markReminderSent(itemId: string): Promise<void> {
  await db
    .update(items)
    .set({ reminderSent: true, updatedAt: new Date() })
    .where(sql`${items.id} = ${itemId} AND ${items.reminderSent} = false`);
}

export async function dispatchReminders(): Promise<{
  picked: number;
  sent: number;
  failed: number;
}> {
  const due = await pickDueItems();
  if (due.length === 0) {
    // Inv-15 still runs even when no fresh due items were picked — a
    // tick with zero pickups can still surface stuck-row warnings.
    await detectPersistentFailures();
    return { picked: 0, sent: 0, failed: 0 };
  }

  const bot = await getBot();
  let sent = 0;
  let failed = 0;

  for (const job of due) {
    const targetTelegramId = job.assigneeTelegramId ?? job.ownerTelegramId;
    const targetLocale = pickLocale(job.assigneeLocale ?? job.ownerLocale);
    const targetTimezone = job.assigneeTimezone ?? job.ownerTimezone ?? "UTC";

    if (!targetTelegramId) {
      // No deliverable target — skip; we cannot send.
      console.error(
        "[cron/dispatch-reminders] no telegram target for item",
        { itemId: job.itemId, listId: job.listId },
      );
      failed += 1;
      continue;
    }

    const body = formatReminderBody({
      locale: targetLocale,
      listEmoji: job.listEmoji,
      listName: job.listName,
      itemText: job.text,
      dueAt: job.dueAt,
      timezone: targetTimezone,
    });

    try {
      await bot.api.sendMessage(targetTelegramId, body, {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      });
      await markReminderSent(job.itemId);
      sent += 1;
    } catch (error) {
      // Do not log item text (might be sensitive); item id only.
      console.error(
        "[cron/dispatch-reminders] sendMessage failed; will retry next tick",
        { itemId: job.itemId, error: String(error) },
      );
      failed += 1;
    }
  }

  // Inv-15 (Phase 4 · P2-5): post-hoc persistent-failure detection. Runs
  // AFTER the per-row dispatch loop. A row that's >5min past due_at and
  // still reminder_sent=false signals an operator-side issue (revoked
  // bot token, user blocked the bot, assignee unreachable). We log a
  // warning per row (cap of 50 to avoid log flood) but do NOT flip the
  // `reminder_sent` flag — operator must intervene. Defensive try/catch
  // so a query failure cannot crash the dispatcher.
  await detectPersistentFailures();

  return { picked: due.length, sent, failed };
}

/**
 * Inv-15: identify items whose `due_at` is >5 minutes in the past and
 * still have `reminder_sent = false`. Each row gets a single
 * `reminder_send_persistent_failure` warning log entry. Capped at 50
 * to avoid log flood when a bot token has been revoked. The detection
 * is purely observability — no DB writes, no exceptions thrown.
 */
async function detectPersistentFailures(): Promise<void> {
  try {
    const stuck = await db
      .select({
        id: items.id,
        listId: items.listId,
        dueAt: items.dueAt,
      })
      .from(items)
      .where(
        sql`${items.dueAt} < (now() - interval '5 minutes')
            AND ${items.reminderSent} = false
            AND ${items.archivedAt} IS NULL`,
      )
      .limit(50);

    for (const row of stuck) {
      console.warn(
        "[cron/dispatch-reminders] reminder_send_persistent_failure",
        {
          itemId: row.id,
          listId: row.listId,
          dueAt: row.dueAt ? row.dueAt.toISOString() : null,
        },
      );
    }
  } catch (error) {
    // Inv-15 contract: detection MUST NEVER crash the dispatcher.
    console.error(
      "[cron/dispatch-reminders] persistent-failure detection threw",
      error,
    );
  }
}

/**
 * Liveness ping — fires whenever the dispatcher loop completes without
 * throwing, regardless of per-row delivery success. The semantic is
 * "is the cron container reaching Postgres", not "is delivery healthy".
 * Per-row failures are observable via the per-item `console.error`
 * logs + Sentry breadcrumbs; configure separate log-based alarms if
 * delivery health matters operationally.
 *
 * Phase 4 · P2-3 resolution.
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
  await maybePingHeartbeat();
}

// Detect "ran as a script" vs "imported as a module". When run via
// `npm run cron` (`tsx`), this file is the entry point and `main()`
// should execute. When unit-tested or imported, only the named exports
// matter.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
      console.error("[cron/dispatch-reminders] fatal", error);
      process.exit(1);
    });
}
