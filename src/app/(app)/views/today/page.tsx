import { CalendarCheck } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { db } from "@/lib/db/client";
import { items, lists } from "@/lib/db/schema";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { requireUser } from "@/lib/server/auth/require-user";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Today smart view — Phase 4.5 default landing for the active
 * workspace. Pulls items from any list in the active workspace where:
 *   - due_at falls today (in user's timezone) AND not done, OR
 *   - status is 'in_progress' AND not archived
 *   - priority='high' open items also surface (urgent, no date)
 *
 * Sort: overdue first, then today, then in_progress / high-priority.
 * Lightweight read-only — no mutations on this page yet (the rows
 * link out to /lists/[id] for editing).
 */
export default async function TodayPage() {
  const user = await requireUser();
  const workspaceId = await resolveActiveWorkspaceId(user.id);

  // Compute "today" end-of-day in the user's timezone via Postgres
  // `at time zone`. Postgres handles IANA names natively
  // (timestamp AT TIME ZONE 'Europe/Istanbul' returns the wall-clock
  // time in Istanbul as a naive timestamp; date_trunc on that, then
  // add 1 day - 1 ms, then convert back to timestamptz). This is
  // DST-correct + host-tz-independent.
  //
  // Note: passing `tz` as a SQL parameter is parameterized — the
  // value goes through pg's bind layer, not string interpolation.
  const tz = user.timezone || "UTC";
  const endOfDayExpr = sql`((date_trunc('day', (now() AT TIME ZONE ${tz})) + interval '1 day' - interval '1 microsecond') AT TIME ZONE ${tz})`;

  const rows = await db
    .select({
      item: items,
      list: { id: lists.id, name: lists.name, emoji: lists.emoji },
    })
    .from(items)
    .innerJoin(lists, eq(items.listId, lists.id))
    .where(
      and(
        eq(lists.workspaceId, workspaceId),
        isNull(items.archivedAt),
        eq(items.isDone, false),
        or(
          // Due today or overdue (dueAt <= end-of-local-day)
          sql`${items.dueAt} is not null and ${items.dueAt} <= ${endOfDayExpr}`,
          // In-progress regardless of date
          eq(items.status, "in_progress"),
          // High-priority items surface here too
          eq(items.priority, "high"),
        ),
      ),
    )
    .orderBy(
      // Overdue first, then today, then position. Sort sentinel
      // pushes null dueAt rows (status='in_progress' / priority='high'
      // without a date) to the end.
      asc(sql`coalesce(${items.dueAt}, '2099-01-01'::timestamptz)`),
      asc(items.position),
    );
  // Reference imports kept live for future filters.
  void gte;
  void lte;

  if (rows.length === 0) {
    return (
      <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
        <header
          style={{
            height: "var(--lb-header-h)",
            padding: "0 var(--lb-sp-4)",
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid var(--lb-border)",
          }}
        >
          <h1
            style={{
              fontSize: "var(--lb-fs-xl)",
              fontWeight: "var(--lb-fw-semibold)",
            }}
          >
            Today
          </h1>
        </header>
        <EmptyState
          icon={<CalendarCheck className="h-6 w-6" aria-hidden />}
          title="Nothing due today"
          description="Schedule items with /create_item due_at, or pin them as in_progress to surface them here."
        />
      </main>
    );
  }

  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <header
        style={{
          height: "var(--lb-header-h)",
          padding: "0 var(--lb-sp-4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <h1
          style={{
            fontSize: "var(--lb-fs-xl)",
            fontWeight: "var(--lb-fw-semibold)",
          }}
        >
          Today
        </h1>
        <span
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-sm)",
          }}
        >
          {rows.length} item{rows.length === 1 ? "" : "s"}
        </span>
      </header>

      <ul
        role="list"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {rows.map(({ item, list }) => (
          <li
            key={item.id}
            style={{
              borderBottom: "1px solid var(--lb-border)",
              padding: "var(--lb-sp-3) var(--lb-sp-4)",
            }}
          >
            <Link
              href={`/lists/${list.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--lb-sp-3)",
                color: "var(--lb-fg)",
                textDecoration: "none",
              }}
            >
              <span style={{ fontSize: "var(--lb-fs-lg)" }}>
                {list.emoji ?? "📋"}
              </span>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div
                  style={{
                    fontSize: "var(--lb-fs-base)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.text}
                </div>
                <div
                  style={{
                    fontSize: "var(--lb-fs-xs)",
                    color: "var(--lb-muted-fg)",
                  }}
                >
                  {list.name}
                  {item.dueAt && (
                    <> · {formatDueAt(item.dueAt, tz)}</>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function formatDueAt(date: Date, tz: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
