/**
 * D1 — bot inline mode read query (Phase 4).
 *
 * `@listbull_bot <query>` in any Telegram chat surfaces up to 10
 * most-recent items across the user's lists. Deterministic + fast — no
 * LLM ranking. ILIKE search over `items.text`, scoped to lists where
 * the caller is a member (any role: owner / editor / viewer can search
 * their own list contents).
 *
 * Limit cap: 10 (per Architect's contract — sub-100ms latency target).
 *
 * Phase 16/inline-C: smart-query prefixes — `bugün`/`today`,
 * `hafta`/`week`, `@username`, `#tag` — short-circuit to filtered
 * queries instead of plain ILIKE search.
 */
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists, users } from "@/lib/db/schema";

export const INLINE_RESULT_CAP = 10;

/**
 * Escape Postgres `LIKE` / `ILIKE` wildcards (`%`, `_`, `\`) so user
 * input is matched literally. Inlined here to keep `db/queries/**` a
 * leaf layer (no imports from `server/**`); the same helper exists in
 * `src/lib/server/tools/_shared.ts` for executor consumers.
 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

export type InlineSearchRow = {
  itemId: string;
  itemText: string;
  itemIsDone: boolean;
  /** ISO 8601. Used to render "added X minutes ago" client-side. */
  itemCreatedAt: string;
  listId: string;
  listName: string;
  listEmoji: string | null;
};

/**
 * Fetch up to `INLINE_RESULT_CAP` items for the inline-query surface.
 *
 * - `query` empty → most-recent items across user's lists
 * - `query` non-empty → ILIKE `%query%` on `items.text`, ranked by
 *   `items.created_at` desc
 *
 * Both branches:
 *   - Filter to lists where the caller has a `list_members` row.
 *   - Skip archived items + archived lists.
 */
export async function searchInlineItems(
  userId: string,
  query: string,
): Promise<InlineSearchRow[]> {
  const trimmed = query.trim();
  const conds = [
    eq(listMembers.userId, userId),
    isNull(items.archivedAt),
    isNull(lists.archivedAt),
  ];

  if (trimmed.length > 0) {
    const escaped = escapeLike(trimmed);
    conds.push(sql`${items.text} ILIKE ${"%" + escaped + "%"}`);
  }

  const rows = await db
    .select({
      itemId: items.id,
      itemText: items.text,
      itemIsDone: items.isDone,
      itemCreatedAt: items.createdAt,
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(and(...conds))
    .orderBy(desc(items.createdAt))
    .limit(INLINE_RESULT_CAP);

  return rows.map((r) => ({
    itemId: r.itemId,
    itemText: r.itemText,
    itemIsDone: r.itemIsDone,
    itemCreatedAt: r.itemCreatedAt.toISOString(),
    listId: r.listId,
    listName: r.listName,
    listEmoji: r.listEmoji,
  }));
}

export type InlineListRow = {
  listId: string;
  listName: string;
  listEmoji: string | null;
  /** Open (un-done, un-archived) item count, for the result subtitle. */
  openCount: number;
};

/**
 * Fetch up to `INLINE_RESULT_CAP` lists for the inline-query surface.
 *
 * - `query` empty → most-recently-created lists across the user's
 *   memberships.
 * - `query` non-empty → ILIKE `%query%` on `lists.name`, ranked by
 *   `lists.created_at` desc.
 *
 * Skips archived lists. Includes a per-list `openCount` so the result
 * card can render "5 open" / "5 açık". The count is computed in a
 * subquery rather than a JOIN so the row count stays bounded.
 */
export async function searchInlineLists(
  userId: string,
  query: string,
): Promise<InlineListRow[]> {
  const trimmed = query.trim();
  const conds = [
    eq(listMembers.userId, userId),
    isNull(lists.archivedAt),
  ];
  if (trimmed.length > 0) {
    const escaped = escapeLike(trimmed);
    conds.push(sql`${lists.name} ILIKE ${"%" + escaped + "%"}`);
  }

  const rows = await db
    .select({
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
      openCount: sql<number>`(
        SELECT count(*)::int FROM ${items}
        WHERE ${items.listId} = ${lists.id}
          AND ${items.isDone} = false
          AND ${items.archivedAt} IS NULL
      )`,
    })
    .from(lists)
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(and(...conds))
    .orderBy(desc(lists.createdAt))
    .limit(INLINE_RESULT_CAP);

  return rows.map((r) => ({
    listId: r.listId,
    listName: r.listName,
    listEmoji: r.listEmoji,
    openCount: r.openCount,
  }));
}

// ─── Smart query helpers (Phase 16/inline-C) ──────────────────────────
//
// Smart queries are recognized in the inline-query handler BEFORE the
// fall-through to ILIKE search. Each smart helper returns the same
// `InlineSearchRow[]` shape so the handler can render uniformly.
//
// Recognized prefixes:
//   bugün, today                 → items.deadline_at in [today, tomorrow)
//   hafta, week, bu hafta        → items.deadline_at in [today, +7d)
//   @username                    → items.assignee_id = (resolved user)
//   #tag                         → items.tags @> ARRAY[tag]
//
// All scoped to lists where the caller is a member, open items only
// (is_done=false, archived_at IS NULL), ordered by deadline ASC then
// created ASC. Cap at INLINE_RESULT_CAP.

/** Items with a deadline in the [start, end) UTC window. */
async function searchByDeadlineWindow(
  userId: string,
  windowStartUtc: Date,
  windowEndUtc: Date,
): Promise<InlineSearchRow[]> {
  const rows = await db
    .select({
      itemId: items.id,
      itemText: items.text,
      itemIsDone: items.isDone,
      itemCreatedAt: items.createdAt,
      itemDeadlineAt: items.deadlineAt,
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, userId),
        eq(items.isDone, false),
        isNull(items.archivedAt),
        isNull(lists.archivedAt),
        gte(items.deadlineAt, windowStartUtc),
        lt(items.deadlineAt, windowEndUtc),
      ),
    )
    .orderBy(asc(items.deadlineAt))
    .limit(INLINE_RESULT_CAP);

  return rows.map((r) => ({
    itemId: r.itemId,
    itemText: r.itemText,
    itemIsDone: r.itemIsDone,
    itemCreatedAt: r.itemCreatedAt.toISOString(),
    listId: r.listId,
    listName: r.listName,
    listEmoji: r.listEmoji,
  }));
}

/**
 * Items due today in the caller's local timezone.
 *
 * Window: [today 00:00 local, tomorrow 00:00 local), converted to UTC
 * for the DB query since `deadline_at` is `timestamp with time zone`.
 * We can't pass the user's TZ-shifted bounds in pure SQL without an
 * extra query, so caller passes the TZ string explicitly.
 */
export async function searchInlineToday(
  userId: string,
  timezone: string,
): Promise<InlineSearchRow[]> {
  const { startUtc, endUtc } = computeLocalDayWindow(timezone, 0, 1);
  return searchByDeadlineWindow(userId, startUtc, endUtc);
}

/** Items due in the next 7 days (local). */
export async function searchInlineWeek(
  userId: string,
  timezone: string,
): Promise<InlineSearchRow[]> {
  const { startUtc, endUtc } = computeLocalDayWindow(timezone, 0, 7);
  return searchByDeadlineWindow(userId, startUtc, endUtc);
}

/**
 * Items assigned to a Telegram username. The username is matched
 * case-insensitively on users.telegram_username. Empty result if no
 * such user exists. The assignee must be a member of the same list
 * (enforced via the listMembers join on the caller).
 */
export async function searchInlineByAssignee(
  callerId: string,
  username: string,
): Promise<InlineSearchRow[]> {
  const normalized = username.replace(/^@/, "").trim().toLowerCase();
  if (normalized.length === 0) return [];

  const [assignee] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.telegramUsername}) = ${normalized}`)
    .limit(1);
  if (!assignee) return [];

  const rows = await db
    .select({
      itemId: items.id,
      itemText: items.text,
      itemIsDone: items.isDone,
      itemCreatedAt: items.createdAt,
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, callerId),
        eq(items.assigneeId, assignee.id),
        eq(items.isDone, false),
        isNull(items.archivedAt),
        isNull(lists.archivedAt),
      ),
    )
    .orderBy(asc(items.deadlineAt), desc(items.createdAt))
    .limit(INLINE_RESULT_CAP);

  return rows.map((r) => ({
    itemId: r.itemId,
    itemText: r.itemText,
    itemIsDone: r.itemIsDone,
    itemCreatedAt: r.itemCreatedAt.toISOString(),
    listId: r.listId,
    listName: r.listName,
    listEmoji: r.listEmoji,
  }));
}

/**
 * Items tagged with `tag` (exact match, case-sensitive — tags are
 * normalized at write time). Uses the items_tags_gin index.
 */
export async function searchInlineByTag(
  userId: string,
  tag: string,
): Promise<InlineSearchRow[]> {
  const normalized = tag.replace(/^#/, "").trim();
  if (normalized.length === 0) return [];

  const rows = await db
    .select({
      itemId: items.id,
      itemText: items.text,
      itemIsDone: items.isDone,
      itemCreatedAt: items.createdAt,
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, userId),
        eq(items.isDone, false),
        isNull(items.archivedAt),
        isNull(lists.archivedAt),
        sql`${items.tags} @> ARRAY[${normalized}]::text[]`,
      ),
    )
    .orderBy(desc(items.createdAt))
    .limit(INLINE_RESULT_CAP);

  return rows.map((r) => ({
    itemId: r.itemId,
    itemText: r.itemText,
    itemIsDone: r.itemIsDone,
    itemCreatedAt: r.itemCreatedAt.toISOString(),
    listId: r.listId,
    listName: r.listName,
    listEmoji: r.listEmoji,
  }));
}

/**
 * Compute [start, end) window for "next N local-days" given a
 * timezone, returning UTC Date objects suitable for the DB. dayOffset
 * is the start offset (0 = today), dayCount the window length.
 */
function computeLocalDayWindow(
  timezone: string,
  dayOffset: number,
  dayCount: number,
): { startUtc: Date; endUtc: Date } {
  // Compute "today" in the caller's local timezone: use Intl to extract
  // y-m-d for now-in-tz, then reconstruct a UTC Date at local midnight.
  // The +7d / +1d math is in local-calendar units, not UTC, so DST
  // boundaries shift correctly.
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) =>
    Number.parseInt(
      parts.find((p) => p.type === type)?.value ?? "0",
      10,
    );
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const h = get("hour");
  const mi = get("minute");
  const s = get("second");

  // local-time midnight at (y,m,d) re-expressed in UTC: subtract the
  // offset from `now` minus midnight-local to get the UTC instant.
  const nowLocalMs = Date.UTC(y, m - 1, d, h, mi, s);
  const offsetMs = nowLocalMs - now.getTime();
  const todayLocalMidnightUtcMs =
    Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return {
    startUtc: new Date(todayLocalMidnightUtcMs + dayOffset * ONE_DAY_MS),
    endUtc: new Date(
      todayLocalMidnightUtcMs + (dayOffset + dayCount) * ONE_DAY_MS,
    ),
  };
}
