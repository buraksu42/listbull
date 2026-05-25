/**
 * Brand-owner ops dashboard metrics — single source of truth.
 *
 * Consumed by both `/ops` SSR page and `/api/ops/stats` JSON endpoint
 * so they can never drift. Reads only — no transaction, just `Promise.all`
 * of independent queries. Counts use `::int` casts (postgres-js returns
 * bigint as string by default; the cast keeps the JSON shape numeric).
 *
 * Performance: at current scale (hundreds of users, thousands of items)
 * every query is index-covered. If usage grows past ~100k items, swap
 * the heavier counts for materialised views.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

export type OpsStats = {
  generatedAt: string;
  users: {
    total: number;
    activeLast7d: number;
    activeLast30d: number;
    localeSplit: Record<string, number>;
    topTimezones: Array<{ timezone: string; count: number }>;
  };
  chats: {
    total: number;
    byType: Record<string, number>;
    keyedShare: number;
    keyedCount: number;
    topActive: Array<{
      chatId: number;
      title: string | null;
      type: string;
      messageCount: number;
    }>;
  };
  items: {
    totalOpen: number;
    totalDone: number;
    totalArchived: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byKind: Record<string, number>;
    overdue: number;
    createdLast7d: number;
    completedLast7d: number;
  };
  throughput: {
    messagesLast14d: Array<{ date: string; count: number }>;
  };
  activity: {
    topActionsLast7d: Array<{ action: string; count: number }>;
  };
  models: {
    topModels: Array<{ model: string; count: number }>;
  };
  reminders: {
    pendingNext24h: number;
    firedLast7d: number;
  };
};

async function selectUsers() {
  const [totals, locales, timezones] = await Promise.all([
    db.execute<{
      total: number;
      active7d: number;
      active30d: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS total,
        (SELECT count(DISTINCT user_id)::int FROM messages
          WHERE created_at >= NOW() - interval '7 days') AS active7d,
        (SELECT count(DISTINCT user_id)::int FROM messages
          WHERE created_at >= NOW() - interval '30 days') AS active30d
    `),
    db.execute<{ locale: string; count: number }>(sql`
      SELECT locale, count(*)::int AS count
      FROM users
      GROUP BY locale
      ORDER BY count DESC
    `),
    db.execute<{ timezone: string; count: number }>(sql`
      SELECT timezone, count(*)::int AS count
      FROM users
      GROUP BY timezone
      ORDER BY count DESC
      LIMIT 5
    `),
  ]);

  const t = totals[0] ?? { total: 0, active7d: 0, active30d: 0 };
  const localeSplit: Record<string, number> = {};
  for (const row of locales) localeSplit[row.locale] = row.count;

  return {
    total: t.total,
    activeLast7d: t.active7d,
    activeLast30d: t.active30d,
    localeSplit,
    topTimezones: timezones.map((r) => ({
      timezone: r.timezone,
      count: r.count,
    })),
  };
}

async function selectChats() {
  const [counts, byType, topActive] = await Promise.all([
    db.execute<{
      total: number;
      keyed: number;
    }>(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE openrouter_api_key_encrypted IS NOT NULL)::int AS keyed
      FROM chats
      WHERE archived_at IS NULL
    `),
    db.execute<{ type: string; count: number }>(sql`
      SELECT type, count(*)::int AS count
      FROM chats
      WHERE archived_at IS NULL
      GROUP BY type
      ORDER BY count DESC
    `),
    db.execute<{
      chat_id: number;
      title: string | null;
      type: string;
      msg_count: number;
    }>(sql`
      SELECT c.chat_id, c.title, c.type, count(m.id)::int AS msg_count
      FROM chats c
      LEFT JOIN messages m
        ON m.chat_id = c.chat_id
       AND m.created_at >= NOW() - interval '30 days'
      WHERE c.archived_at IS NULL
      GROUP BY c.chat_id
      HAVING count(m.id) > 0
      ORDER BY msg_count DESC
      LIMIT 5
    `),
  ]);

  const c = counts[0] ?? { total: 0, keyed: 0 };
  const byTypeMap: Record<string, number> = {};
  for (const row of byType) byTypeMap[row.type] = row.count;

  return {
    total: c.total,
    keyedCount: c.keyed,
    // Fraction 0..1; floor at 0 to avoid NaN when total=0.
    keyedShare: c.total > 0 ? c.keyed / c.total : 0,
    byType: byTypeMap,
    topActive: topActive.map((r) => ({
      chatId: r.chat_id,
      title: r.title,
      type: r.type,
      messageCount: r.msg_count,
    })),
  };
}

async function selectItems() {
  const [counts, byStatus, byPriority, byKind] = await Promise.all([
    db.execute<{
      open: number;
      done: number;
      archived: number;
      overdue: number;
      created7d: number;
      completed7d: number;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE archived_at IS NULL AND is_done = false)::int AS open,
        count(*) FILTER (WHERE archived_at IS NULL AND is_done = true)::int AS done,
        count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
        count(*) FILTER (
          WHERE archived_at IS NULL
            AND is_done = false
            AND deadline_at IS NOT NULL
            AND deadline_at < NOW()
        )::int AS overdue,
        count(*) FILTER (WHERE created_at >= NOW() - interval '7 days')::int AS created7d,
        count(*) FILTER (WHERE completed_at >= NOW() - interval '7 days')::int AS completed7d
      FROM items
    `),
    db.execute<{ status: string; count: number }>(sql`
      SELECT status, count(*)::int AS count
      FROM items
      WHERE archived_at IS NULL
      GROUP BY status
      ORDER BY count DESC
    `),
    db.execute<{ priority: string; count: number }>(sql`
      SELECT priority, count(*)::int AS count
      FROM items
      WHERE archived_at IS NULL
      GROUP BY priority
      ORDER BY count DESC
    `),
    db.execute<{ kind: string; count: number }>(sql`
      SELECT kind, count(*)::int AS count
      FROM items
      WHERE archived_at IS NULL
      GROUP BY kind
      ORDER BY count DESC
    `),
  ]);

  const c = counts[0] ?? {
    open: 0,
    done: 0,
    archived: 0,
    overdue: 0,
    created7d: 0,
    completed7d: 0,
  };
  const byStatusMap: Record<string, number> = {};
  for (const row of byStatus) byStatusMap[row.status] = row.count;
  const byPriorityMap: Record<string, number> = {};
  for (const row of byPriority) byPriorityMap[row.priority] = row.count;
  const byKindMap: Record<string, number> = {};
  for (const row of byKind) byKindMap[row.kind] = row.count;

  return {
    totalOpen: c.open,
    totalDone: c.done,
    totalArchived: c.archived,
    overdue: c.overdue,
    createdLast7d: c.created7d,
    completedLast7d: c.completed7d,
    byStatus: byStatusMap,
    byPriority: byPriorityMap,
    byKind: byKindMap,
  };
}

async function selectThroughput() {
  // 14-day window, day-bucketed. `generate_series` ensures empty days
  // show up as 0 (vs missing) — important so the array length is
  // always 14 and renders predictably.
  const rows = await db.execute<{ day: Date; count: number }>(sql`
    WITH days AS (
      SELECT generate_series(
        (NOW() AT TIME ZONE 'UTC')::date - interval '13 days',
        (NOW() AT TIME ZONE 'UTC')::date,
        interval '1 day'
      )::date AS day
    )
    SELECT
      d.day,
      count(m.id)::int AS count
    FROM days d
    LEFT JOIN messages m
      ON (m.created_at AT TIME ZONE 'UTC')::date = d.day
    GROUP BY d.day
    ORDER BY d.day ASC
  `);
  return {
    messagesLast14d: rows.map((r) => ({
      date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      count: r.count,
    })),
  };
}

async function selectActivity() {
  const rows = await db.execute<{ action: string; count: number }>(sql`
    SELECT action, count(*)::int AS count
    FROM activity_log
    WHERE created_at >= NOW() - interval '7 days'
    GROUP BY action
    ORDER BY count DESC
    LIMIT 10
  `);
  return {
    topActionsLast7d: rows.map((r) => ({
      action: r.action,
      count: r.count,
    })),
  };
}

async function selectModels() {
  // user-level preference distribution. Doesn't reflect what models
  // actually serve traffic (chats.llm_model overrides + free-tier
  // overrides both happen at request time), but it's the cheapest
  // shape that tells the operator what users *picked*.
  const rows = await db.execute<{ model: string; count: number }>(sql`
    SELECT llm_model AS model, count(*)::int AS count
    FROM users
    GROUP BY llm_model
    ORDER BY count DESC
    LIMIT 5
  `);
  return {
    topModels: rows.map((r) => ({ model: r.model, count: r.count })),
  };
}

async function selectReminders() {
  const [row] = await db.execute<{ pending: number; fired: number }>(sql`
    SELECT
      count(*) FILTER (
        WHERE sent = false AND remind_at <= NOW() + interval '24 hours'
      )::int AS pending,
      count(*) FILTER (
        WHERE sent_at >= NOW() - interval '7 days'
      )::int AS fired
    FROM item_reminders
  `);
  return {
    pendingNext24h: row?.pending ?? 0,
    firedLast7d: row?.fired ?? 0,
  };
}

/**
 * Fetches every dashboard metric in parallel. Read-only, no transaction
 * needed — counts are independent and a few seconds of drift between
 * them is acceptable for a dashboard refresh.
 */
export async function getOpsStats(): Promise<OpsStats> {
  const [users, chats, items, throughput, activity, models, reminders] =
    await Promise.all([
      selectUsers(),
      selectChats(),
      selectItems(),
      selectThroughput(),
      selectActivity(),
      selectModels(),
      selectReminders(),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    users,
    chats,
    items,
    throughput,
    activity,
    models,
    reminders,
  };
}
