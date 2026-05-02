"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import * as React from "react";

import { ActivityRow } from "@/components/activity/activity-row";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import {
  dayKey,
  formatDayLabel,
  type SupportedLocale,
} from "@/lib/i18n/relative-time";
import type { ActivityFeedRow } from "@/lib/types";
import type { ActivityFeedResponse } from "@/lib/validators/activity";

/**
 * Activity feed — Phase 3.
 *
 * - Polled fetch via TanStack `useInfiniteQuery`. Polling driven by
 *   `QueryProvider`'s 5s interval (paused on hidden tab via Page
 *   Visibility — already wired globally).
 * - Day-grouping: client-side. We bucket rows by `dayKey(createdAt)`
 *   computed in the user's local time, then render a sticky header
 *   for each bucket. Backend returns rows ordered by `created_at desc`
 *   so the natural iteration order = newest day first.
 * - Pagination: cursor-based via `before=` query param. Each fetched
 *   page returns `nextCursor: string | null`. We surface a "Load more"
 *   affordance when more pages exist.
 *
 * The localized sentences live in `<ActivitySentence />`; we just
 * orchestrate fetch/group/render here.
 */
const PAGE_SIZE = 50;

/** P2-2: consume Backend-published response shape directly. */
type ActivityResponse = ActivityFeedResponse;

const activityKey = (listId: string) => ["activity", listId] as const;

export function ActivityList({
  listId,
  locale,
}: {
  listId: string;
  locale: SupportedLocale;
}) {
  const query = useInfiniteQuery<
    ActivityResponse,
    Error,
    { pages: ActivityResponse[]; pageParams: (string | null)[] },
    readonly ["activity", string],
    string | null
  >({
    queryKey: activityKey(listId),
    queryFn: async ({ pageParam }) => {
      const url = new URL(
        `/api/lists/${listId}/activity`,
        typeof window === "undefined" ? "http://localhost" : window.location.origin,
      );
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (pageParam) url.searchParams.set("before", pageParam);
      return apiFetch<ActivityResponse>(url.pathname + url.search);
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const allRows: ActivityFeedRow[] = React.useMemo(() => {
    const pages = query.data?.pages ?? [];
    const flat: ActivityFeedRow[] = [];
    for (const p of pages) flat.push(...p.rows);
    return flat;
  }, [query.data]);

  const groups = React.useMemo(() => groupByDay(allRows, locale), [allRows, locale]);

  if (query.isLoading) {
    return <ListLoading />;
  }

  if (query.isError) {
    return (
      <EmptyState
        title="Couldn't load activity"
        description={query.error?.message ?? "Try again."}
      />
    );
  }

  if (allRows.length === 0) {
    return (
      <EmptyState
        title={locale === "tr" ? "Henüz etkinlik yok" : "No activity yet"}
        description={
          locale === "tr"
            ? "Bu listedeki değişiklikler burada görünür."
            : "Changes to this list will appear here."
        }
      />
    );
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h2
            className="sticky top-0 z-10 px-4 py-2"
            style={{
              fontSize: "var(--lg-fs-sm)",
              fontWeight: "var(--lg-fw-semibold)",
              color: "var(--lg-muted-fg)",
              background: "var(--lg-bg)",
              borderBottom: "1px solid var(--lg-border)",
              letterSpacing: "var(--lg-tracking-title)",
            }}
          >
            {group.label}
          </h2>
          <ul style={{ margin: 0, padding: 0 }}>
            {group.rows.map((row) => (
              <ActivityRow key={row.id} row={row} locale={locale} />
            ))}
          </ul>
        </section>
      ))}

      {query.hasNextPage && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "var(--lg-sp-4)",
          }}
        >
          <Button
            type="button"
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage
              ? locale === "tr"
                ? "Yükleniyor…"
                : "Loading…"
              : locale === "tr"
                ? "Daha eski"
                : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ListLoading() {
  return (
    <div role="status" aria-live="polite" style={{ padding: "var(--lg-sp-6) 0" }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: "var(--lg-sp-3)",
            padding: "var(--lg-sp-3) var(--lg-sp-4)",
            borderBottom: "1px solid var(--lg-border)",
            alignItems: "flex-start",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--lg-r-full)",
              background: "var(--lg-muted)",
            }}
          />
          <div style={{ flex: 1 }}>
            <span
              aria-hidden
              style={{
                display: "block",
                width: "70%",
                height: 12,
                borderRadius: "var(--lg-r-sm)",
                background: "var(--lg-muted)",
                marginBottom: 6,
              }}
            />
            <span
              aria-hidden
              style={{
                display: "block",
                width: "30%",
                height: 10,
                borderRadius: "var(--lg-r-sm)",
                background: "var(--lg-muted)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

type DayGroup = {
  key: string;
  label: string;
  rows: ActivityFeedRow[];
};

function groupByDay(
  rows: ActivityFeedRow[],
  locale: SupportedLocale,
): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  const now = new Date();
  for (const row of rows) {
    const key = dayKey(row.createdAt);
    if (!current || current.key !== key) {
      current = { key, label: formatDayLabel(row.createdAt, locale, now), rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }
  return groups;
}
