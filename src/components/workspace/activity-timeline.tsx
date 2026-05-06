"use client";

import { useEffect, useState } from "react";

import type { ActivityFeedRow } from "@/lib/types";

type Props = {
  workspaceId: string;
};

/**
 * Workspace activity timeline. Day-grouped, sticky labels, "load
 * more" pagination via `before` cursor. Shows actor + sentence per
 * row; non-localized (Phase 6.5 admin surface — operators speak
 * mixed locales). Phase 7+ may localize via next-intl.
 */
export function ActivityTimeline({ workspaceId }: Props) {
  const [rows, setRows] = useState<ActivityFeedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    const lastRow = rows[rows.length - 1];
    if (!lastRow) return;
    await runFetch(lastRow.createdAt, true);
  }

  async function runFetch(before: string | undefined, append: boolean) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(
        `/api/workspaces/${workspaceId}/activity`,
        window.location.origin,
      );
      url.searchParams.set("limit", "50");
      if (before) url.searchParams.set("before", before);

      const res = await fetch(url.toString());
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { rows: ActivityFeedRow[] } }
        | { ok: false; error: { message: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        setError(json && !json.ok ? json.error.message : `HTTP ${res.status}`);
        return;
      }
      const fresh = json.data.rows;
      setRows((prev) => (append ? [...prev, ...fresh] : fresh));
      if (fresh.length < 50) setExhausted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/activity?limit=50`,
        );
        const json = (await res.json().catch(() => null)) as
          | { ok: true; data: { rows: ActivityFeedRow[] } }
          | { ok: false; error: { message: string } }
          | null;
        if (cancelled) return;
        if (!res.ok || !json || !json.ok) {
          setError(
            json && !json.ok ? json.error.message : `HTTP ${res.status}`,
          );
          return;
        }
        setRows(json.data.rows);
        if (json.data.rows.length < 50) setExhausted(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Group rows by local-date string.
  const byDay = new Map<string, ActivityFeedRow[]>();
  for (const r of rows) {
    const day = new Date(r.createdAt).toLocaleDateString();
    const list = byDay.get(day);
    if (list) {
      list.push(r);
    } else {
      byDay.set(day, [r]);
    }
  }

  return (
    <section>
      <div
        style={{
          fontSize: "var(--lb-fs-xs)",
          color: "var(--lb-muted-fg)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "var(--lb-sp-2)",
        }}
      >
        Activity
      </div>
      <div
        style={{
          background: "var(--lb-card)",
          border: "1px solid var(--lb-border)",
          borderRadius: "var(--lb-radius-md)",
          overflow: "hidden",
        }}
      >
        {rows.length === 0 && !loading && (
          <p
            style={{
              padding: "var(--lb-sp-4)",
              color: "var(--lb-muted-fg)",
              fontSize: "var(--lb-fs-sm)",
              margin: 0,
            }}
          >
            Henüz aktivite yok.
          </p>
        )}

        {Array.from(byDay.entries()).map(([day, dayRows]) => (
          <div key={day}>
            <div
              style={{
                position: "sticky",
                top: 0,
                background: "var(--lb-muted)",
                color: "var(--lb-muted-fg)",
                padding: "var(--lb-sp-1) var(--lb-sp-3)",
                fontSize: "var(--lb-fs-xs)",
                fontWeight: "var(--lb-fw-medium)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {day}
            </div>
            {dayRows.map((r) => (
              <ActivityRowView key={r.id} row={r} />
            ))}
          </div>
        ))}

        {!exhausted && rows.length > 0 && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadMore()}
            style={{
              width: "100%",
              background: "transparent",
              color: "var(--lb-fg)",
              border: "none",
              borderTop: "1px solid var(--lb-border)",
              padding: "var(--lb-sp-3)",
              fontSize: "var(--lb-fs-sm)",
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "Yükleniyor…" : "Daha eskisini yükle"}
          </button>
        )}

        {error && (
          <p
            style={{
              padding: "var(--lb-sp-3)",
              color: "var(--lb-destructive, #D72D40)",
              fontSize: "var(--lb-fs-xs)",
              margin: 0,
              borderTop: "1px solid var(--lb-border)",
            }}
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function ActivityRowView({ row }: { row: ActivityFeedRow }) {
  const time = new Date(row.createdAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--lb-sp-3)",
        padding: "var(--lb-sp-2) var(--lb-sp-3)",
        borderBottom: "1px solid var(--lb-border)",
        fontSize: "var(--lb-fs-sm)",
      }}
    >
      <span
        style={{
          color: "var(--lb-muted-fg)",
          fontSize: "var(--lb-fs-xs)",
          fontFamily: "var(--lb-font-mono, monospace)",
          minWidth: 44,
        }}
      >
        {time}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--lb-fg)", fontWeight: "var(--lb-fw-medium)" }}>
          {row.actorFirstName}
          {row.actorUsername && (
            <span
              style={{
                marginLeft: "var(--lb-sp-1)",
                color: "var(--lb-muted-fg)",
                fontWeight: "var(--lb-fw-regular)",
              }}
            >
              @{row.actorUsername}
            </span>
          )}
        </span>
        <span
          style={{
            color: "var(--lb-muted-fg)",
            marginLeft: "var(--lb-sp-2)",
          }}
        >
          {humanAction(row.action)}
        </span>
      </div>
      <span
        style={{
          color: "var(--lb-muted-fg)",
          fontSize: "var(--lb-fs-xs)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {row.entityType}
      </span>
    </div>
  );
}

function humanAction(action: string): string {
  // Compact, locale-neutral verbs. Phase 7+ swap to next-intl.
  const map: Record<string, string> = {
    item_created: "added an item",
    item_completed: "marked an item done",
    item_uncompleted: "marked an item open",
    item_edited: "edited an item",
    item_deleted: "deleted an item",
    item_assigned: "assigned an item",
    item_unassigned: "unassigned an item",
    item_due_set: "scheduled an item",
    item_due_cleared: "cleared a due date",
    list_created: "created a list",
    list_renamed: "renamed a list",
    list_archived: "archived a list",
    list_restored: "restored a list",
    member_added: "added a list member",
    member_removed: "removed a list member",
    member_role_changed: "changed a list member's role",
    workspace_created: "created the workspace",
    workspace_renamed: "renamed the workspace",
    workspace_member_added: "joined the workspace",
    workspace_member_removed: "removed a workspace member",
    workspace_member_role_changed: "changed a workspace member's role",
  };
  return map[action] ?? action;
}
