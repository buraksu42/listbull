"use client";

import { useEffect, useState, type FormEvent } from "react";

type Member = {
  memberId: string;
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer" | "guest";
  acceptedAt: string;
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
  };
};

type Props = {
  workspaceId: string;
  /** Owner-only role/remove actions; admin can invite. */
  isOwner: boolean;
  isOwnerOrAdmin: boolean;
  /** Personal Workspace can't have additional members. */
  isPersonal: boolean;
};

const ROLE_OPTIONS: Array<Member["role"]> = [
  "admin",
  "editor",
  "viewer",
  "guest",
];

/**
 * Workspace members section — list + invite + remove + role change.
 * Phase 5.5 deliverable closing the "Coming next" gap.
 */
export function MembersSection({
  workspaceId,
  isOwner,
  isOwnerOrAdmin,
  isPersonal,
}: Props) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Member["role"]>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`);
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { members: Member[] } }
        | { ok: false }
        | null;
      if (json && json.ok) setMembers(json.data.members);
    } catch {
      // Silent.
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/members`);
        const json = (await res.json().catch(() => null)) as
          | { ok: true; data: { members: Member[] } }
          | { ok: false }
          | null;
        if (!cancelled && json && json.ok) setMembers(json.data.members);
      } catch {
        // Silent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (busy || !username.trim()) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          role,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok: true;
            data: {
              status: "invite_sent" | "already_member" | "pending_phase_5";
              warnings?: string[];
            };
          }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        setError(
          json && !json.ok ? json.error.message : `HTTP ${res.status}`,
        );
        setBusy(false);
        return;
      }
      if (json.data.status === "already_member") {
        setInfo("Bu kullanıcı zaten workspace üyesi.");
      } else if ((json.data.warnings ?? []).includes("invitee_dm_failed")) {
        setInfo(
          "Davet hazır ama bot'a /start edilmediği için DM atılamadı; linki kendin ulaştırabilirsin.",
        );
      } else {
        setInfo("Davet linki gönderildi.");
      }
      setUsername("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(memberId: string, displayName: string) {
    if (
      !window.confirm(
        `${displayName} workspace'ten kaldırılacak. Liste erişimleri ve item atamaları temizlenecek. Devam?`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/members/${memberId}`,
        { method: "DELETE" },
      );
      if (res.ok) await refresh();
    } catch {
      // Silent.
    }
  }

  async function onRoleChange(memberId: string, nextRole: Member["role"]) {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/members/${memberId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        },
      );
      if (res.ok) await refresh();
    } catch {
      // Silent.
    }
  }

  if (isPersonal) return null;

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
        Members
      </div>
      <div
        style={{
          background: "var(--lb-card)",
          border: "1px solid var(--lb-border)",
          borderRadius: "var(--lb-radius-md)",
          padding: "var(--lb-sp-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-3)",
        }}
      >
        {members === null ? (
          <p style={{ color: "var(--lb-muted-fg)", fontSize: "var(--lb-fs-sm)" }}>
            Yükleniyor…
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--lb-sp-2)",
            }}
          >
            {members.map((m) => (
              <li
                key={m.memberId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--lb-sp-3)",
                  padding: "var(--lb-sp-2) 0",
                  borderBottom: "1px solid var(--lb-border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "var(--lb-fs-base)",
                      fontWeight: "var(--lb-fw-medium)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.user.telegramFirstName}
                    {m.user.telegramUsername && (
                      <span
                        style={{
                          marginLeft: "var(--lb-sp-2)",
                          color: "var(--lb-muted-fg)",
                          fontSize: "var(--lb-fs-xs)",
                          fontWeight: "var(--lb-fw-regular)",
                        }}
                      >
                        @{m.user.telegramUsername}
                      </span>
                    )}
                  </div>
                </div>
                {isOwner && m.role !== "owner" ? (
                  <select
                    value={m.role}
                    onChange={(e) =>
                      onRoleChange(
                        m.memberId,
                        e.target.value as Member["role"],
                      )
                    }
                    style={{
                      background: "var(--lb-bg)",
                      color: "var(--lb-fg)",
                      border: "1px solid var(--lb-border)",
                      borderRadius: "var(--lb-radius-md)",
                      padding: "2px 6px",
                      fontSize: "var(--lb-fs-xs)",
                    }}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    style={{
                      color: "var(--lb-muted-fg)",
                      fontSize: "var(--lb-fs-xs)",
                      textTransform: "capitalize",
                    }}
                  >
                    {m.role}
                  </span>
                )}
                {isOwner && m.role !== "owner" && (
                  <button
                    type="button"
                    onClick={() =>
                      onRemove(
                        m.memberId,
                        m.user.telegramUsername
                          ? `@${m.user.telegramUsername}`
                          : m.user.telegramFirstName,
                      )
                    }
                    style={{
                      background: "transparent",
                      color: "var(--lb-destructive, #D72D40)",
                      border: "1px solid currentColor",
                      padding: "2px 8px",
                      borderRadius: "var(--lb-radius-md)",
                      fontSize: "var(--lb-fs-xs)",
                      cursor: "pointer",
                    }}
                  >
                    Kaldır
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwnerOrAdmin && (
          <form
            onSubmit={onInvite}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--lb-sp-2)",
              borderTop: "1px solid var(--lb-border)",
              paddingTop: "var(--lb-sp-3)",
            }}
          >
            <label
              style={{
                fontSize: "var(--lb-fs-sm)",
                color: "var(--lb-muted-fg)",
              }}
            >
              Telegram @username (örn. @ali)
            </label>
            <div
              style={{
                display: "flex",
                gap: "var(--lb-sp-2)",
                flexWrap: "wrap",
              }}
            >
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@ali"
                style={{
                  flex: 1,
                  minWidth: 140,
                  background: "var(--lb-bg)",
                  color: "var(--lb-fg)",
                  border: "1px solid var(--lb-border)",
                  borderRadius: "var(--lb-radius-md)",
                  padding: "var(--lb-sp-2) var(--lb-sp-3)",
                  fontSize: "var(--lb-fs-sm)",
                }}
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Member["role"])}
                style={{
                  background: "var(--lb-bg)",
                  color: "var(--lb-fg)",
                  border: "1px solid var(--lb-border)",
                  borderRadius: "var(--lb-radius-md)",
                  padding: "0 var(--lb-sp-2)",
                  fontSize: "var(--lb-fs-sm)",
                }}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy || !username.trim()}
                style={{
                  background: "var(--lb-accent)",
                  color: "var(--lb-accent-fg)",
                  border: "none",
                  padding: "var(--lb-sp-2) var(--lb-sp-4)",
                  borderRadius: "var(--lb-radius-md)",
                  fontSize: "var(--lb-fs-sm)",
                  fontWeight: "var(--lb-fw-medium)",
                  cursor:
                    busy || !username.trim() ? "not-allowed" : "pointer",
                  opacity: busy || !username.trim() ? 0.6 : 1,
                }}
              >
                {busy ? "Gönderiliyor…" : "Davet et"}
              </button>
            </div>
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
          </form>
        )}
      </div>
    </section>
  );
}
