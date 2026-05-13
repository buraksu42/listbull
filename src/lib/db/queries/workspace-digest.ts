/**
 * Per-workspace daily digest query (Phase 16/#27).
 *
 * Returns three buckets the bot uses to render a "bugünün işleri"
 * (today's work) message:
 *
 *   1. dueToday    — deadline_at in [local today, local tomorrow)
 *   2. overdue     — deadline_at < local today, still open (≤7d ago)
 *   3. assignedOpen — assignee_id set, open, deadline NULL or future
 *
 * Each bucket is scoped to lists the caller can see (membership join)
 * AND limited to the requested workspace. Rows are enriched with the
 * parent list (name + emoji) and assignee snapshot (first_name +
 * username) so the bot can render mentions without a second round-
 * trip.
 *
 * Timezone: caller passes the TZ string (workspace owner's TZ for
 * cron auto-push; user's TZ for on-demand). Date window is computed
 * in JS via Intl.DateTimeFormat to keep the SQL portable.
 */
import { and, asc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists, users } from "@/lib/db/schema";

export type DigestItemRow = {
  itemId: string;
  itemText: string;
  itemStatus: string;
  itemPriority: string;
  deadlineAt: Date | null;
  listId: string;
  listName: string;
  listEmoji: string | null;
  assigneeUsername: string | null;
  assigneeFirstName: string | null;
};

export type WorkspaceDailyDigest = {
  dueToday: DigestItemRow[];
  overdue: DigestItemRow[];
  assignedOpen: DigestItemRow[];
};

/**
 * Compute [start, end) UTC window for `today` in the caller's local
 * timezone, plus the start-of-7-days-ago boundary for the "overdue"
 * bucket.
 */
function computeDailyBounds(timezone: string): {
  todayStartUtc: Date;
  tomorrowStartUtc: Date;
  weekAgoStartUtc: Date;
} {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const h = get("hour");
  const mi = get("minute");
  const s = get("second");

  const nowLocalMs = Date.UTC(y, m - 1, d, h, mi, s);
  const offsetMs = nowLocalMs - now.getTime();
  const todayLocalMidnightUtcMs =
    Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;

  const ONE_DAY = 24 * 60 * 60 * 1000;
  return {
    todayStartUtc: new Date(todayLocalMidnightUtcMs),
    tomorrowStartUtc: new Date(todayLocalMidnightUtcMs + ONE_DAY),
    weekAgoStartUtc: new Date(todayLocalMidnightUtcMs - 7 * ONE_DAY),
  };
}

export async function getWorkspaceDailyDigest(args: {
  userId: string;
  workspaceId: string;
  timezone: string;
}): Promise<WorkspaceDailyDigest> {
  const { todayStartUtc, tomorrowStartUtc, weekAgoStartUtc } =
    computeDailyBounds(args.timezone);

  // Single fan-out query: we fetch every item the user can see in the
  // workspace that's either in [todayStart, tomorrowStart) OR (overdue
  // within 7d) OR (assigned + open with no deadline / future deadline).
  // Bucket assignment happens in JS to keep the SQL simple — one round
  // trip, three filters.
  const assigneeAlias = users;
  const rows = await db
    .select({
      itemId: items.id,
      itemText: items.text,
      itemStatus: items.status,
      itemPriority: items.priority,
      itemIsDone: items.isDone,
      deadlineAt: items.deadlineAt,
      assigneeId: items.assigneeId,
      listId: lists.id,
      listName: lists.name,
      listEmoji: lists.emoji,
      assigneeUsername: assigneeAlias.telegramUsername,
      assigneeFirstName: assigneeAlias.telegramFirstName,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .leftJoin(assigneeAlias, eq(assigneeAlias.id, items.assigneeId))
    .where(
      and(
        eq(listMembers.userId, args.userId),
        eq(lists.workspaceId, args.workspaceId),
        isNull(lists.archivedAt),
        isNull(items.archivedAt),
        eq(items.isDone, false),
        or(
          // due today
          and(
            isNotNull(items.deadlineAt),
            gte(items.deadlineAt, todayStartUtc),
            lt(items.deadlineAt, tomorrowStartUtc),
          ),
          // overdue (last 7 days)
          and(
            isNotNull(items.deadlineAt),
            gte(items.deadlineAt, weekAgoStartUtc),
            lt(items.deadlineAt, todayStartUtc),
          ),
          // assigned + open (no deadline OR future deadline ≠ today)
          and(
            isNotNull(items.assigneeId),
            ne(items.status, "done"),
            or(
              isNull(items.deadlineAt),
              gte(items.deadlineAt, tomorrowStartUtc),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(items.deadlineAt), asc(items.position));

  const dueToday: DigestItemRow[] = [];
  const overdue: DigestItemRow[] = [];
  const assignedOpen: DigestItemRow[] = [];

  for (const r of rows) {
    const base: DigestItemRow = {
      itemId: r.itemId,
      itemText: r.itemText,
      itemStatus: r.itemStatus,
      itemPriority: r.itemPriority,
      deadlineAt: r.deadlineAt,
      listId: r.listId,
      listName: r.listName,
      listEmoji: r.listEmoji,
      assigneeUsername: r.assigneeUsername,
      assigneeFirstName: r.assigneeFirstName,
    };

    if (r.deadlineAt && r.deadlineAt >= todayStartUtc && r.deadlineAt < tomorrowStartUtc) {
      dueToday.push(base);
    } else if (
      r.deadlineAt &&
      r.deadlineAt < todayStartUtc &&
      r.deadlineAt >= weekAgoStartUtc
    ) {
      overdue.push(base);
    } else if (r.assigneeId) {
      assignedOpen.push(base);
    }
  }

  return { dueToday, overdue, assignedOpen };
}

/** sql utility — keeps import live so tree-shaker doesn't drop it. */
void sql;