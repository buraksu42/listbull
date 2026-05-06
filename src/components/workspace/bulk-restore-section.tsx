"use client";

import { useEffect, useState } from "react";

type DeleteRow = {
  id: string;
  listId: string;
  listName: string;
  itemText: string;
  actorFirstName: string;
  actorUsername: string | null;
  deletedAt: string;
};

type Props = {
  workspaceId: string;
};

/**
 * Bulk restore section on the workspace admin dashboard (Phase
 * 6.5). Workspace owner-only. Lists last-30d item_deleted activity
 * across all lists in the workspace; multi-select + "Restore
 * selected" hits the bulk-restore endpoint.
 *
 * Per-row failures don't abort; the response surfaces them so the
 * UI can report partial-success.
 */
export function BulkRestoreSection({ workspaceId }: Props) {
  const [rows, setRows] = useState<DeleteRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/recent-deletes`,
      );
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { deletes: DeleteRow[] } }
        | { ok: false; error: { message: string } }
        | null;
      if (json && json.ok) {
        setRows(json.data.deletes);
        setSelected(new Set());
      }
    } catch {
      // Silent.
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/recent-deletes`,
        );
        const json = (await res.json().catch(() => null)) as
          | { ok: true; data: { deletes: DeleteRow[] } }
          | { ok: false; error: { message: string } }
          | null;
        if (!cancelled && json && json.ok) setRows(json.data.deletes);
      } catch {
        // Silent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function restoreSelected() {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setInfo(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/bulk-restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ activityIds: Array.from(selected) }),
        },
      );
      const json = (await res.json().catch(() => null)) as
        | {
            ok: true;
            data: {
              restored: number;
              failed: Array<{ id: string; reason: string }>;
            };
          }
        | { ok: false; error: { message: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        setError(
          json && !json.ok ? json.error.message : `HTTP ${res.status}`,
        );
        setBusy(false);
        return;
      }
      const { restored, failed } = json.data;
      const failPart =
        failed.length > 0
          ? ` ${failed.length} satır geri yüklenemedi (${failed.map((f) => f.reason).join(", ")})`
          : "";
      setInfo(`${restored} item geri yüklendi.${failPart}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
        Recent deletions (30 day window)
      </div>
      <div
        style={{
          background: "var(--lb-card)",
          border: "1px solid var(--lb-border)",
          borderRadius: "var(--lb-radius-md)",
          overflow: "hidden",
        }}
      >
        {rows === null ? (
          <p
            style={{
              padding: "var(--lb-sp-3)",
              color: "var(--lb-muted-fg)",
              fontSize: "var(--lb-fs-sm)",
              margin: 0,
            }}
          >
            Yükleniyor…
          </p>
        ) : rows.length === 0 ? (
          <p
            style={{
              padding: "var(--lb-sp-3)",
              color: "var(--lb-muted-fg)",
              fontSize: "var(--lb-fs-sm)",
              margin: 0,
            }}
          >
            Son 30 günde silinen item yok.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((r) => {
              const isChecked = selected.has(r.id);
              return (
                <li
                  key={r.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--lb-sp-3)",
                    padding: "var(--lb-sp-2) var(--lb-sp-3)",
                    borderBottom: "1px solid var(--lb-border)",
                    fontSize: "var(--lb-fs-sm)",
                    cursor: "pointer",
                    background: isChecked ? "var(--lb-muted)" : "transparent",
                  }}
                  onClick={() => toggle(r.id)}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(r.id)}
                    style={{ flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: "var(--lb-fw-medium)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.itemText}
                    </div>
                    <div
                      style={{
                        color: "var(--lb-muted-fg)",
                        fontSize: "var(--lb-fs-xs)",
                      }}
                    >
                      {r.listName} · {r.actorFirstName}
                      {r.actorUsername && ` (@${r.actorUsername})`} ·{" "}
                      {new Date(r.deletedAt).toLocaleString()}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {rows && rows.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--lb-sp-3)",
              padding: "var(--lb-sp-3)",
              borderTop: "1px solid var(--lb-border)",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-xs)",
              }}
            >
              {selected.size} / {rows.length} seçili
            </span>
            <div
              style={{
                display: "flex",
                gap: "var(--lb-sp-2)",
                alignItems: "center",
              }}
            >
              {info && (
                <span
                  style={{
                    color: "var(--lb-success, #2EB872)",
                    fontSize: "var(--lb-fs-xs)",
                  }}
                >
                  {info}
                </span>
              )}
              {error && (
                <span
                  style={{
                    color: "var(--lb-destructive, #D72D40)",
                    fontSize: "var(--lb-fs-xs)",
                  }}
                  role="alert"
                >
                  {error}
                </span>
              )}
              <button
                type="button"
                onClick={restoreSelected}
                disabled={busy || selected.size === 0}
                style={{
                  background: "var(--lb-accent)",
                  color: "var(--lb-accent-fg)",
                  border: "none",
                  padding: "var(--lb-sp-2) var(--lb-sp-4)",
                  borderRadius: "var(--lb-radius-md)",
                  fontWeight: "var(--lb-fw-medium)",
                  fontSize: "var(--lb-fs-sm)",
                  cursor:
                    busy || selected.size === 0
                      ? "not-allowed"
                      : "pointer",
                  opacity: busy || selected.size === 0 ? 0.6 : 1,
                }}
              >
                {busy ? "Yükleniyor…" : "Seçilenleri geri yükle"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
