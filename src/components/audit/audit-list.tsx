"use client";

/**
 * a11y notes: the list uses `role="list"` (implicit on `<ul>`) with
 * `role="listitem"` on each row's `<li>`. Filter chips above are a
 * `role="radiogroup"`. Live region (`aria-live="polite"`) at the top
 * announces filter changes for screen readers via the visible heading.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import * as React from "react";

import { AuditRow } from "@/components/audit/audit-row";
import {
  AUDIT_FILTERS,
  FilterChips,
  type AuditFilter,
} from "@/components/audit/filter-chips";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import {
  dayKey,
  formatDayLabel,
  type SupportedLocale,
} from "@/lib/i18n/relative-time";
import type { AuditFeedResponse } from "@/lib/validators/activity";
import type { AuditEntryWithRestore } from "@/lib/types";

const PAGE_SIZE = 50;

type AuditResponse = AuditFeedResponse;

type AuditListProps = {
  listId: string;
  locale: SupportedLocale;
  labels: {
    filterAll: string;
    filterDeletions: string;
    filterEdits: string;
    filterPermissions: string;
    filterGroupLabel: string;
    empty: string;
    emptyDescription: string;
    loadMore: string;
    loading: string;
    loadFailed: string;
    restore: string;
    restoring: string;
    restored: string;
    restoreFailed: string;
    restoreUnavailable: string;
  };
};

export function AuditList({ listId, locale, labels }: AuditListProps) {
  const [filter, setFilter] = React.useState<AuditFilter>("all");

  const query = useInfiniteQuery<
    AuditResponse,
    Error,
    { pages: AuditResponse[]; pageParams: (string | null)[] },
    readonly ["audit", string, AuditFilter],
    string | null
  >({
    queryKey: ["audit", listId, filter] as const,
    queryFn: async ({ pageParam }) => {
      const url = new URL(
        `/api/lists/${listId}/audit`,
        typeof window === "undefined"
          ? "http://localhost"
          : window.location.origin,
      );
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("filter", filter);
      if (pageParam) url.searchParams.set("before", pageParam);
      return apiFetch<AuditResponse>(url.pathname + url.search);
    },
    initialPageParam: null,
    // Backend ships `hasMore: boolean` (no cursor in payload). We derive
    // the next page param from the last row's `createdAt`, which the
    // route handler accepts as `?before=`.
    getNextPageParam: (last) => {
      if (!last.hasMore || last.rows.length === 0) return null;
      const tail = last.rows[last.rows.length - 1];
      return tail?.createdAt ?? null;
    },
  });

  const allRows: AuditEntryWithRestore[] = React.useMemo(() => {
    const pages = query.data?.pages ?? [];
    const flat: AuditEntryWithRestore[] = [];
    for (const p of pages) flat.push(...p.rows);
    return flat;
  }, [query.data]);

  const groups = React.useMemo(
    () => groupByDay(allRows, locale),
    [allRows, locale],
  );

  const filterLabels = {
    all: labels.filterAll,
    deletions: labels.filterDeletions,
    edits: labels.filterEdits,
    permissions: labels.filterPermissions,
  } satisfies Record<AuditFilter, string>;

  return (
    <div>
      <FilterChips
        value={filter}
        onChange={(next) => {
          if (AUDIT_FILTERS.includes(next)) setFilter(next);
        }}
        labels={filterLabels}
        groupLabel={labels.filterGroupLabel}
      />

      {/* Live region — filter changes are announced indirectly via the
          chip's checked-state change, but we also surface result count
          for screen readers. */}
      <p aria-live="polite" className="sr-only">
        {filterLabels[filter]} · {allRows.length}
      </p>

      {query.isLoading ? (
        <ListLoading />
      ) : query.isError ? (
        <EmptyState
          title={labels.loadFailed}
          description={query.error?.message ?? labels.loading}
        />
      ) : allRows.length === 0 ? (
        <EmptyState title={labels.empty} description={labels.emptyDescription} />
      ) : (
        <>
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
                  <AuditRow
                    key={row.id}
                    row={row}
                    listId={listId}
                    locale={locale}
                    restoreLabels={{
                      restore: labels.restore,
                      restoring: labels.restoring,
                      restored: labels.restored,
                      failed: labels.restoreFailed,
                      unavailable: labels.restoreUnavailable,
                    }}
                  />
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
                {query.isFetchingNextPage ? labels.loading : labels.loadMore}
              </Button>
            </div>
          )}
        </>
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
  rows: AuditEntryWithRestore[];
};

function groupByDay(
  rows: AuditEntryWithRestore[],
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
