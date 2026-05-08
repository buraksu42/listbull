import Link from "next/link";

import { WeekGrid } from "@/components/views/week-grid";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { listItemsByDeadlineRange } from "@/lib/db/queries/views";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * Phase 15: week calendar view. URL deep-link via `?from=YYYY-MM-DD`.
 * SSR fetches the items for the requested range so first paint is
 * fully populated; the client grid then polls via TanStack Query.
 */
export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await requireUser();
  const workspaceId = await resolveActiveWorkspaceId(user.id);

  const params = await searchParams;
  const monday = mondayOfWeek(params.from, user.timezone || "UTC");
  const sunday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const initialItems = await listItemsByDeadlineRange({
    userId: user.id,
    workspaceId,
    from: monday,
    to: sunday,
  });

  const fromIso = monday.toISOString();
  const toIso = sunday.toISOString();

  return (
    <main className="flex flex-col gap-3 pb-12">
      <header
        style={{
          padding: "var(--lb-sp-3) var(--lb-sp-4)",
          borderBottom: "1px solid var(--lb-border)",
        }}
        className="flex items-center justify-between gap-2"
      >
        <h1 className="text-base font-semibold text-[var(--lb-fg)]">
          {user.locale === "tr" ? "Bu hafta" : "This week"}
        </h1>
        <nav className="flex items-center gap-1">
          <WeekNavLink
            offsetDays={-7}
            from={monday}
            label={user.locale === "tr" ? "‹ Önceki" : "‹ Prev"}
          />
          <WeekNavLink
            offsetDays={7}
            from={monday}
            label={user.locale === "tr" ? "Sonraki ›" : "Next ›"}
          />
        </nav>
      </header>
      <WeekGrid
        userId={user.id}
        workspaceId={workspaceId}
        userTimezone={user.timezone || "UTC"}
        userLocale={(user.locale === "tr" ? "tr" : "en") as "tr" | "en"}
        userDateFormat={
          (user.dateFormat as "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD") ??
          "DD.MM.YYYY"
        }
        userTimeFormat={(user.timeFormat as "24h" | "12h") ?? "24h"}
        from={fromIso}
        to={toIso}
        initialItems={initialItems.map((r) => ({
          id: r.id,
          listId: r.listId,
          text: r.text,
          deadlineAt: r.deadlineAt ? r.deadlineAt.toISOString() : null,
          priority: r.priority,
          status: r.status,
          isDone: r.isDone,
          list: r.list,
        }))}
      />
    </main>
  );
}

function WeekNavLink({
  offsetDays,
  from,
  label,
}: {
  offsetDays: number;
  from: Date;
  label: string;
}) {
  const target = new Date(from.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(target.getUTCDate()).padStart(2, "0");
  return (
    <Link
      href={`/views/week?from=${yyyy}-${mm}-${dd}`}
      className="rounded-[var(--lb-r-sm)] px-2 py-1 text-xs text-[var(--lb-muted-fg)] hover:bg-[var(--lb-card)]"
    >
      {label}
    </Link>
  );
}

/**
 * Resolve the Monday-anchored start of the visible week.
 *
 * Default (no `from`): the Monday of the current week in the user's
 * timezone. Explicit `from`: snapped to the preceding Monday so a
 * link like `?from=2026-05-13` (Wednesday) still lands on a coherent
 * grid start.
 */
function mondayOfWeek(fromParam: string | undefined, tz: string): Date {
  const anchor = fromParam ? new Date(`${fromParam}T00:00:00Z`) : new Date();
  if (Number.isNaN(anchor.getTime())) {
    return mondayOfWeek(undefined, tz);
  }
  // Find the wall-clock day-of-week in the user's timezone via Intl,
  // then convert to a 1..7 (Mon=1) index for arithmetic.
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(anchor);
  const idx = map[name] ?? 1;
  // Step back to Monday in the user's timezone, then snap to UTC
  // midnight of that local date.
  const localY = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
    }).format(anchor),
    10,
  );
  const localM = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "2-digit",
    }).format(anchor),
    10,
  );
  const localD = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      day: "2-digit",
    }).format(anchor),
    10,
  );
  const monday = new Date(Date.UTC(localY, localM - 1, localD - (idx - 1)));
  return monday;
}
