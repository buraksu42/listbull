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
 *
 * Window parameter (7 | 30 | 90): time-window dropdown on the page,
 * forwarded via `?window=` on /ops + /api/ops/stats. Default 7.
 * Fixed-window stats (active7d/30d, fired 7d, created7d/completed7d)
 * stay anchored so they keep their kalibration meaning regardless of
 * which window the operator picked — only the new metrics (velocity,
 * retention, tags, attachments) plus throughput + activity follow it.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

export type OpsWindow = 7 | 30 | 90;

export function parseOpsWindow(raw: string | string[] | undefined): OpsWindow {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "30") return 30;
  if (v === "90") return 90;
  return 7;
}

export type OpsStats = {
  generatedAt: string;
  window: OpsWindow;
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
    messagesByDay: Array<{ date: string; count: number }>;
  };
  activity: {
    topActions: Array<{ action: string; count: number }>;
  };
  models: {
    topModels: Array<{ model: string; count: number }>;
  };
  reminders: {
    pendingNext24h: number;
    firedLast7d: number;
  };
  velocity: {
    createdInWindow: number;
    completedInWindow: number;
  };
  retention: {
    signedUpInWindow: number;
    activeInWindow: number;
    totalUsers: number;
  };
  tags: {
    topTags: Array<{ tag: string; count: number }>;
  };
  itemsPerChat: {
    p50: number;
    p95: number;
    max: number;
    avg: number;
  };
  attachments: {
    totalCount: number;
    byKind: Record<string, number>;
    totalBytes: number;
    addedInWindow: number;
  };
  groupEngagement: {
    /** Total group/supergroup chats with at least one member row. */
    groupChats: number;
    /** Sum of distinct members across all group chats. */
    totalMembers: number;
    /** Members who posted ≥1 message in the window, across all groups. */
    activeMembersInWindow: number;
    /** Avg members per group (rounded). */
    avgMembersPerGroup: number;
    /** Active / total — engagement ratio. */
    activeRatio: number;
  };
  cohortRetention: {
    /**
     * Signup-week × active-week grid. Each row = a signup ISO week
     * (Monday-anchored, last 12 weeks); each cell tracks how many of
     * that cohort were active in a later week (week 0 = signup week,
     * week 1 = next week, …). The UI renders this as a heatmap.
     */
    rows: Array<{
      cohort: string;
      size: number;
      weeks: number[];
    }>;
    /** Max bucket value for heatmap colour scaling. */
    maxCount: number;
  };
  dowSeasonality: {
    /** Mon=1 … Sun=7 message totals across the window. */
    byDow: Array<{ dow: number; count: number }>;
  };
  chatLifespan: {
    /**
     * Distribution of archived chat lifespans (created → archived) in
     * days. p50/p95/max/avg + archived count + currently-archived rate
     * (archived / total).
     */
    archivedCount: number;
    totalChats: number;
    archivedRate: number;
    p50Days: number;
    p95Days: number;
    maxDays: number;
    avgDays: number;
  };
  remindersEfficacy: {
    /** Reminders that fired (sent_at within window). */
    firedInWindow: number;
    /** Reminders currently pending whose remind_at fell INSIDE the window. */
    overdueInWindow: number;
    /** Fired / (fired + overdue) — quality of the cron loop. */
    efficacy: number;
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

async function selectThroughput(windowDays: OpsWindow) {
  // `generate_series` ensures empty days show up as 0 (vs missing) so
  // the array length is always `windowDays` and renders predictably.
  // `interval '1 day' * N` sends N as a bind parameter — safe even
  // though the windowDays whitelist is already enforced upstream.
  const rows = await db.execute<{ day: Date; count: number }>(sql`
    WITH days AS (
      SELECT generate_series(
        (NOW() AT TIME ZONE 'UTC')::date - (interval '1 day' * ${windowDays - 1}),
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
    messagesByDay: rows.map((r) => ({
      date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      count: r.count,
    })),
  };
}

async function selectActivity(windowDays: OpsWindow) {
  const rows = await db.execute<{ action: string; count: number }>(sql`
    SELECT action, count(*)::int AS count
    FROM activity_log
    WHERE created_at >= NOW() - (interval '1 day' * ${windowDays})
    GROUP BY action
    ORDER BY count DESC
    LIMIT 10
  `);
  return {
    topActions: rows.map((r) => ({
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

async function selectVelocity(windowDays: OpsWindow) {
  // Window-bound create-vs-complete counts. Operator reads the ratio
  // (UI-side) as "what fraction of work flowing in is closing out".
  // Sub-1 ratio = backlog growing.
  const [row] = await db.execute<{
    created: number;
    completed: number;
  }>(sql`
    SELECT
      count(*) FILTER (
        WHERE created_at >= NOW() - (interval '1 day' * ${windowDays})
      )::int AS created,
      count(*) FILTER (
        WHERE completed_at >= NOW() - (interval '1 day' * ${windowDays})
      )::int AS completed
    FROM items
  `);
  return {
    createdInWindow: row?.created ?? 0,
    completedInWindow: row?.completed ?? 0,
  };
}

async function selectRetention(windowDays: OpsWindow) {
  // Simple churn-ish signal. NOT a cohort matrix — we surface raw
  // numerators + denominators and let the UI do the ratio. Future
  // work upgrades this to a full signup-week × active-week grid.
  const [row] = await db.execute<{
    signed_up: number;
    active: number;
    total: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM users
        WHERE created_at >= NOW() - (interval '1 day' * ${windowDays})
      ) AS signed_up,
      (SELECT count(DISTINCT user_id)::int FROM messages
        WHERE created_at >= NOW() - (interval '1 day' * ${windowDays})
      ) AS active,
      (SELECT count(*)::int FROM users) AS total
  `);
  return {
    signedUpInWindow: row?.signed_up ?? 0,
    activeInWindow: row?.active ?? 0,
    totalUsers: row?.total ?? 0,
  };
}

async function selectTags(windowDays: OpsWindow) {
  // unnest the text[] column then count occurrences. Scoped to live
  // items (archived_at IS NULL) so deleted lists don't pollute the
  // signal; window'd on created_at so we see what's currently in
  // play, not what's been there forever.
  const rows = await db.execute<{ tag: string; count: number }>(sql`
    SELECT tag, count(*)::int AS count
    FROM items, unnest(tags) AS tag
    WHERE archived_at IS NULL
      AND created_at >= NOW() - (interval '1 day' * ${windowDays})
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 10
  `);
  return {
    topTags: rows.map((r) => ({ tag: r.tag, count: r.count })),
  };
}

async function selectItemsPerChat() {
  // Point-in-time distribution (no window). Tells the operator
  // whether one chat is a power-user outlier vs the bulk. p95/max
  // gap is the noise-floor for "do we need pagination tuning?".
  const [row] = await db.execute<{
    p50: number;
    p95: number;
    max: number;
    avg: number;
  }>(sql`
    WITH counts AS (
      SELECT chat_id, count(*)::int AS n
      FROM items
      WHERE archived_at IS NULL
      GROUP BY chat_id
    )
    SELECT
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY n), 0)::int AS p50,
      COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY n), 0)::int AS p95,
      COALESCE(max(n), 0)::int AS max,
      COALESCE(avg(n), 0)::float AS avg
    FROM counts
  `);
  return {
    p50: row?.p50 ?? 0,
    p95: row?.p95 ?? 0,
    max: row?.max ?? 0,
    avg: row?.avg ?? 0,
  };
}

async function selectAttachments(windowDays: OpsWindow) {
  // Telegram file_id refs only — the bytes live on Telegram's CDN —
  // but we still track `file_size` so the operator has a "how much
  // user data would we need to re-host if Telegram ever ToS'd us"
  // number. by_kind splits photo / video / document / etc.
  const [totals, byKind] = await Promise.all([
    db.execute<{
      total: number;
      total_bytes: number;
      added: number;
    }>(sql`
      SELECT
        count(*)::int AS total,
        COALESCE(SUM(file_size), 0)::bigint AS total_bytes,
        count(*) FILTER (
          WHERE created_at >= NOW() - (interval '1 day' * ${windowDays})
        )::int AS added
      FROM item_attachments
    `),
    db.execute<{ kind: string; count: number }>(sql`
      SELECT kind, count(*)::int AS count
      FROM item_attachments
      GROUP BY kind
      ORDER BY count DESC
    `),
  ]);
  const t = totals[0] ?? { total: 0, total_bytes: 0, added: 0 };
  const byKindMap: Record<string, number> = {};
  for (const row of byKind) byKindMap[row.kind] = row.count;
  // total_bytes comes back as bigint string from postgres-js; Number
  // is fine up to 9 PB which we'll never approach for a Telegram-CDN
  // metadata store.
  return {
    totalCount: t.total,
    totalBytes: Number(t.total_bytes ?? 0),
    addedInWindow: t.added,
    byKind: byKindMap,
  };
}

async function selectGroupEngagement(windowDays: OpsWindow) {
  // Join chat_members against messages to surface group-chat engagement:
  // how many members EACH group has, vs how many actually posted inside
  // the window. `chat_members` was never queried before — Tier 3 fills
  // that gap. Scope to group / supergroup chats only; DMs have a single
  // member by definition and would skew the average.
  const [totals, active] = await Promise.all([
    db.execute<{
      group_chats: number;
      total_members: number;
    }>(sql`
      SELECT
        count(DISTINCT cm.chat_id)::int AS group_chats,
        count(*)::int AS total_members
      FROM chat_members cm
      INNER JOIN chats c
        ON c.chat_id = cm.chat_id
       AND c.type IN ('group', 'supergroup')
       AND c.archived_at IS NULL
    `),
    db.execute<{ active_members: number }>(sql`
      SELECT count(DISTINCT m.user_id)::int AS active_members
      FROM messages m
      INNER JOIN chats c
        ON c.chat_id = m.chat_id
       AND c.type IN ('group', 'supergroup')
       AND c.archived_at IS NULL
      WHERE m.created_at >= NOW() - (interval '1 day' * ${windowDays})
    `),
  ]);
  const t = totals[0] ?? { group_chats: 0, total_members: 0 };
  const a = active[0] ?? { active_members: 0 };
  const avg = t.group_chats > 0 ? Math.round(t.total_members / t.group_chats) : 0;
  const ratio = t.total_members > 0 ? a.active_members / t.total_members : 0;
  return {
    groupChats: t.group_chats,
    totalMembers: t.total_members,
    activeMembersInWindow: a.active_members,
    avgMembersPerGroup: avg,
    activeRatio: ratio,
  };
}

async function selectCohortRetention() {
  // Signup-week × active-week heatmap. Truncate signup timestamps to
  // ISO Monday-anchored weeks (date_trunc('week', …)) and bucket each
  // user's messages by weeks since signup. We cap at 12 cohorts × 12
  // week offsets so the grid stays scannable on a card.
  //
  // No window param — cohorts are an all-time concept; the "last 12
  // cohorts" cap already provides recency. If the user-base grows past
  // 12 weeks of consistent signups this still shows the most recent
  // 12, with older ones falling off naturally.
  const rows = await db.execute<{
    cohort: Date;
    week_offset: number;
    n: number;
  }>(sql`
    WITH cohorts AS (
      SELECT
        id AS user_id,
        date_trunc('week', created_at)::date AS cohort_week
      FROM users
      WHERE created_at >= NOW() - interval '12 weeks'
    ),
    activity AS (
      SELECT
        c.cohort_week,
        FLOOR(
          EXTRACT(EPOCH FROM date_trunc('week', m.created_at) - c.cohort_week) / 604800
        )::int AS week_offset,
        m.user_id
      FROM cohorts c
      INNER JOIN messages m ON m.user_id = c.user_id
      WHERE m.created_at >= c.cohort_week
    )
    SELECT
      cohort_week AS cohort,
      week_offset,
      count(DISTINCT user_id)::int AS n
    FROM activity
    WHERE week_offset BETWEEN 0 AND 11
    GROUP BY cohort_week, week_offset
    ORDER BY cohort_week ASC, week_offset ASC
  `);
  const sizesRows = await db.execute<{ cohort: Date; size: number }>(sql`
    SELECT
      date_trunc('week', created_at)::date AS cohort,
      count(*)::int AS size
    FROM users
    WHERE created_at >= NOW() - interval '12 weeks'
    GROUP BY date_trunc('week', created_at)
    ORDER BY cohort ASC
  `);
  // Pivot the (cohort, week_offset, n) rows into per-cohort week arrays.
  const grid = new Map<string, number[]>();
  for (const row of rows) {
    const key =
      row.cohort instanceof Date
        ? row.cohort.toISOString().slice(0, 10)
        : String(row.cohort);
    let arr = grid.get(key);
    if (!arr) {
      arr = new Array<number>(12).fill(0);
      grid.set(key, arr);
    }
    arr[row.week_offset] = row.n;
  }
  const cohorts: Array<{
    cohort: string;
    size: number;
    weeks: number[];
  }> = [];
  let maxCount = 0;
  for (const s of sizesRows) {
    const key =
      s.cohort instanceof Date
        ? s.cohort.toISOString().slice(0, 10)
        : String(s.cohort);
    const weeks = grid.get(key) ?? new Array<number>(12).fill(0);
    for (const v of weeks) if (v > maxCount) maxCount = v;
    cohorts.push({ cohort: key, size: s.size, weeks });
  }
  return { rows: cohorts, maxCount };
}

async function selectDowSeasonality(windowDays: OpsWindow) {
  // PostgreSQL EXTRACT(ISODOW) returns Mon=1 … Sun=7 (vs DOW which is
  // Sun=0 … Sat=6). ISODOW lines up with how Turkish + European users
  // think of "Monday first", so we use it. Fill missing days with 0.
  const rows = await db.execute<{ dow: number; count: number }>(sql`
    WITH base AS (
      SELECT generate_series(1, 7) AS dow
    )
    SELECT
      b.dow,
      COALESCE(count(m.id), 0)::int AS count
    FROM base b
    LEFT JOIN messages m
      ON EXTRACT(ISODOW FROM m.created_at)::int = b.dow
     AND m.created_at >= NOW() - (interval '1 day' * ${windowDays})
    GROUP BY b.dow
    ORDER BY b.dow ASC
  `);
  return {
    byDow: rows.map((r) => ({ dow: r.dow, count: r.count })),
  };
}

async function selectChatLifespan() {
  // Days between created_at and archived_at for chats that ARE
  // archived. Point-in-time, no window — archived chats are a
  // historical population. percentile_cont needs FLOAT8 not integer
  // days; COALESCE the empty-set case to 0.
  const [row] = await db.execute<{
    total: number;
    archived: number;
    p50: number;
    p95: number;
    max: number;
    avg: number;
  }>(sql`
    WITH lifespans AS (
      SELECT EXTRACT(EPOCH FROM (archived_at - created_at)) / 86400.0 AS days
      FROM chats
      WHERE archived_at IS NOT NULL
    )
    SELECT
      (SELECT count(*)::int FROM chats) AS total,
      (SELECT count(*)::int FROM chats WHERE archived_at IS NOT NULL) AS archived,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY days), 0)::float AS p50,
      COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY days), 0)::float AS p95,
      COALESCE(max(days), 0)::float AS max,
      COALESCE(avg(days), 0)::float AS avg
    FROM lifespans
  `);
  const t = row?.total ?? 0;
  const a = row?.archived ?? 0;
  return {
    archivedCount: a,
    totalChats: t,
    archivedRate: t > 0 ? a / t : 0,
    p50Days: Math.round(row?.p50 ?? 0),
    p95Days: Math.round(row?.p95 ?? 0),
    maxDays: Math.round(row?.max ?? 0),
    avgDays: Number(((row?.avg ?? 0) as number).toFixed(1)),
  };
}

async function selectRemindersEfficacy(windowDays: OpsWindow) {
  // Cron quality metric:
  //   fired   = reminders whose sent_at fell inside the window
  //   overdue = reminders whose remind_at fell inside the window but
  //             never got marked sent (cron skipped them)
  // efficacy = fired / (fired + overdue). 1.0 means every due reminder
  // actually went out. Sub-0.99 in production = investigate the cron.
  const [row] = await db.execute<{
    fired: number;
    overdue: number;
  }>(sql`
    SELECT
      count(*) FILTER (
        WHERE sent_at >= NOW() - (interval '1 day' * ${windowDays})
      )::int AS fired,
      count(*) FILTER (
        WHERE sent = false
          AND remind_at >= NOW() - (interval '1 day' * ${windowDays})
          AND remind_at < NOW()
      )::int AS overdue
    FROM item_reminders
  `);
  const f = row?.fired ?? 0;
  const o = row?.overdue ?? 0;
  const denom = f + o;
  return {
    firedInWindow: f,
    overdueInWindow: o,
    efficacy: denom > 0 ? f / denom : 1,
  };
}

/**
 * Fetches every dashboard metric in parallel. Read-only, no transaction
 * needed — counts are independent and a few seconds of drift between
 * them is acceptable for a dashboard refresh.
 */
export async function getOpsStats(window: OpsWindow = 7): Promise<OpsStats> {
  const [
    users,
    chats,
    items,
    throughput,
    activity,
    models,
    reminders,
    velocity,
    retention,
    tags,
    itemsPerChat,
    attachments,
    groupEngagement,
    cohortRetention,
    dowSeasonality,
    chatLifespan,
    remindersEfficacy,
  ] = await Promise.all([
    selectUsers(),
    selectChats(),
    selectItems(),
    selectThroughput(window),
    selectActivity(window),
    selectModels(),
    selectReminders(),
    selectVelocity(window),
    selectRetention(window),
    selectTags(window),
    selectItemsPerChat(),
    selectAttachments(window),
    selectGroupEngagement(window),
    selectCohortRetention(),
    selectDowSeasonality(window),
    selectChatLifespan(),
    selectRemindersEfficacy(window),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    window,
    users,
    chats,
    items,
    throughput,
    activity,
    models,
    reminders,
    velocity,
    retention,
    tags,
    itemsPerChat,
    attachments,
    groupEngagement,
    cohortRetention,
    dowSeasonality,
    chatLifespan,
    remindersEfficacy,
  };
}
