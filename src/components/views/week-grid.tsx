"use client";

/**
 * Phase 15: 7-column week grid (tablet+) / single-day swipe (mobile).
 *
 * Pure render: SSR delivers the initial item set, TanStack Query
 * polls every 5s afterwards. Tap an item card → opens its parent
 * list page (`/lists/[id]`). Tap an empty cell → opens the quick-
 * add modal (default Inbox + 09:00).
 *
 * Mobile heuristic: the grid is `lg:grid-cols-7` on screens ≥1024px;
 * below that, only the focused day renders with prev/next swipe
 * affordances (tap the date pill to switch day). Telegram Mini App
 * viewport is ~600-700px so most users hit the mobile path.
 */
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { CompactItemCard } from "@/components/views/compact-item-card";
import { formatDate } from "@/lib/utils/format-date";

type WeekItem = {
  id: string;
  listId: string;
  text: string;
  deadlineAt: string | null;
  priority: string;
  status: string;
  isDone: boolean;
  list: { id: string; name: string; emoji: string | null };
};

type Props = {
  userId: string;
  workspaceId: string;
  userTimezone: string;
  userLocale: "tr" | "en";
  userDateFormat: "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  userTimeFormat: "24h" | "12h";
  /** ISO datetime — Monday 00:00 UTC. */
  from: string;
  /** ISO datetime — next Monday 00:00 UTC (exclusive). */
  to: string;
  initialItems: WeekItem[];
};

const WEEKDAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const WEEKDAY_LABEL: Record<"tr" | "en", Record<string, string>> = {
  tr: {
    monday: "Pzt",
    tuesday: "Sal",
    wednesday: "Çar",
    thursday: "Per",
    friday: "Cum",
    saturday: "Cmt",
    sunday: "Paz",
  },
  en: {
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
    sunday: "Sun",
  },
};

export function WeekGrid({
  workspaceId,
  userTimezone,
  userLocale,
  userDateFormat,
  userTimeFormat,
  from,
  to,
  initialItems,
}: Props) {
  const queryKey = [
    "views",
    "week",
    workspaceId,
    from,
    to,
  ] as const;

  const itemsQuery = useQuery<WeekItem[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ from, to, workspaceId });
      const res = await fetch(`/api/views/week?${params}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as {
        ok: true;
        data: { items: WeekItem[] };
      };
      return json.data.items;
    },
    initialData: initialItems,
    refetchInterval: 5000,
    staleTime: 5000,
  });

  // Bucket items by their day-in-user-timezone (YYYY-MM-DD key).
  const buckets = React.useMemo(() => {
    const map = new Map<string, WeekItem[]>();
    for (const it of itemsQuery.data ?? []) {
      if (!it.deadlineAt) continue;
      const key = userTzDateKey(it.deadlineAt, userTimezone);
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    return map;
  }, [itemsQuery.data, userTimezone]);

  const days: DayBucket[] = React.useMemo(() => {
    const start = new Date(from);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const keyName = WEEKDAY_KEYS[i] ?? "monday";
      return {
        key: keyName,
        date: d,
        dateKey: utcDateKey(d),
        label: WEEKDAY_LABEL[userLocale][keyName] ?? keyName,
        items: buckets.get(utcDateKey(d)) ?? [],
      };
    });
  }, [from, buckets, userLocale]);

  // Mobile single-day index — defaults to today (or Monday if today is
  // outside the visible week).
  const todayIso = utcDateKey(new Date());
  const initialDayIdx =
    Math.max(
      0,
      days.findIndex((d) => d.dateKey === todayIso),
    ) || 0;
  const [activeDay, setActiveDay] = React.useState(initialDayIdx);

  return (
    <div className="flex flex-col gap-3">
      {/* Mobile: single-day with prev/next chevrons. */}
      <div className="flex flex-col gap-2 px-4 lg:hidden">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setActiveDay((d) => Math.max(0, d - 1))}
            disabled={activeDay === 0}
            className="rounded-[var(--lb-r-sm)] px-2 py-1 text-sm text-[var(--lb-muted-fg)] disabled:opacity-30"
          >
            ‹
          </button>
          <DayHeader day={days[activeDay]} userLocale={userLocale} />
          <button
            type="button"
            onClick={() => setActiveDay((d) => Math.min(6, d + 1))}
            disabled={activeDay === 6}
            className="rounded-[var(--lb-r-sm)] px-2 py-1 text-sm text-[var(--lb-muted-fg)] disabled:opacity-30"
          >
            ›
          </button>
        </div>
        <DayColumn
          day={days[activeDay]}
          userTimezone={userTimezone}
          userLocale={userLocale}
          userDateFormat={userDateFormat}
          userTimeFormat={userTimeFormat}
        />
      </div>

      {/* Tablet+ : 7-column grid. */}
      <div className="hidden gap-2 px-4 lg:grid lg:grid-cols-7">
        {days.map((day) => (
          <div key={day.key} className="flex min-w-0 flex-col gap-2">
            <DayHeader day={day} userLocale={userLocale} />
            <DayColumn
              day={day}
              userTimezone={userTimezone}
              userLocale={userLocale}
              userDateFormat={userDateFormat}
              userTimeFormat={userTimeFormat}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

type DayBucket = {
  key: string;
  date: Date;
  dateKey: string;
  label: string;
  items: WeekItem[];
};

function DayHeader({
  day,
  userLocale,
}: {
  day: DayBucket | undefined;
  userLocale: "tr" | "en";
}) {
  if (!day) return null;
  const isToday = day.dateKey === utcDateKey(new Date());
  const dayNum = day.date.getUTCDate();
  return (
    <div
      className="flex items-baseline gap-2"
      style={{
        color: isToday ? "var(--lb-accent)" : "var(--lb-fg)",
        fontWeight: isToday ? 600 : 500,
      }}
    >
      <span className="text-xs uppercase tracking-wide text-[var(--lb-muted-fg)]">
        {day.label}
      </span>
      <span className="text-sm">{dayNum}</span>
      {isToday && (
        <span className="text-[10px] uppercase tracking-wide text-[var(--lb-accent)]">
          {userLocale === "tr" ? "bugün" : "today"}
        </span>
      )}
    </div>
  );
}

function DayColumn({
  day,
  userTimezone,
  userLocale,
  userDateFormat,
  userTimeFormat,
}: {
  day: DayBucket | undefined;
  userTimezone: string;
  userLocale: "tr" | "en";
  userDateFormat: "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  userTimeFormat: "24h" | "12h";
}) {
  if (!day) return null;
  if (day.items.length === 0) {
    return (
      <p className="text-xs text-[var(--lb-muted-fg)]">
        {userLocale === "tr" ? "Bu güne ait öğe yok." : "No items today."}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {day.items.map((item) => (
        <li key={item.id}>
          <CompactItemCard
            item={item}
            timeLabel={
              item.deadlineAt
                ? formatDate(item.deadlineAt, {
                    locale: userLocale,
                    timezone: userTimezone,
                    dateFormat: userDateFormat,
                    timeFormat: userTimeFormat,
                    show: "time",
                  })
                : ""
            }
          />
        </li>
      ))}
    </ul>
  );
}

/** YYYY-MM-DD key in the user's timezone. */
function userTzDateKey(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const yy = parts.find((p) => p.type === "year")?.value ?? "0000";
  const mm = parts.find((p) => p.type === "month")?.value ?? "01";
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${yy}-${mm}-${dd}`;
}

/** YYYY-MM-DD key in UTC (matches the day cells generated above). */
function utcDateKey(d: Date): string {
  const yy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
