"use client";

import { useEffect, useState } from "react";

type Member = {
  memberId: string;
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer" | "guest";
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
  };
};

type Cap = {
  workspaceId: string;
  userId: string;
  dailyCapUsdMicro: number;
  monthlyCapUsdMicro: number;
};

type Props = {
  workspaceId: string;
};

/**
 * Per-member spend caps section (Phase 8 P8-D). Visible only on
 * Workspace-tier admin dashboard. Lists each non-owner member with
 * their daily + monthly USD cap inputs. Caps are in USD; we
 * round-trip through micro-USD storage on save.
 *
 * 0 = unlimited (default). Cleared rows are deleted from
 * workspace_member_caps so absence-of-row also reads as unlimited.
 */
export function CapsSection({ workspaceId }: Props) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [caps, setCaps] = useState<Map<string, Cap>>(new Map());
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [mRes, cRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/members`),
        fetch(`/api/workspaces/${workspaceId}/caps`),
      ]);
      const mJson = (await mRes.json().catch(() => null)) as
        | { ok: true; data: { members: Member[] } }
        | { ok: false }
        | null;
      const cJson = (await cRes.json().catch(() => null)) as
        | { ok: true; data: { caps: Cap[] } }
        | { ok: false }
        | null;
      if (mJson && mJson.ok) setMembers(mJson.data.members);
      if (cJson && cJson.ok) {
        const map = new Map<string, Cap>();
        for (const c of cJson.data.caps) map.set(c.userId, c);
        setCaps(map);
      }
    } catch {
      // Silent.
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mRes, cRes] = await Promise.all([
          fetch(`/api/workspaces/${workspaceId}/members`),
          fetch(`/api/workspaces/${workspaceId}/caps`),
        ]);
        const mJson = (await mRes.json().catch(() => null)) as
          | { ok: true; data: { members: Member[] } }
          | { ok: false }
          | null;
        const cJson = (await cRes.json().catch(() => null)) as
          | { ok: true; data: { caps: Cap[] } }
          | { ok: false }
          | null;
        if (cancelled) return;
        if (mJson && mJson.ok) setMembers(mJson.data.members);
        if (cJson && cJson.ok) {
          const map = new Map<string, Cap>();
          for (const c of cJson.data.caps) map.set(c.userId, c);
          setCaps(map);
        }
      } catch {
        // Silent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function saveCap(
    userId: string,
    dailyUsd: number,
    monthlyUsd: number,
  ) {
    setSavingFor(userId);
    setError(null);
    try {
      const dailyCapUsdMicro = Math.round(dailyUsd * 1_000_000);
      const monthlyCapUsdMicro = Math.round(monthlyUsd * 1_000_000);

      // Both 0 → DELETE; otherwise PUT.
      const url = `/api/workspaces/${workspaceId}/caps?userId=${encodeURIComponent(userId)}`;
      const res =
        dailyCapUsdMicro === 0 && monthlyCapUsdMicro === 0
          ? await fetch(url, { method: "DELETE" })
          : await fetch(url, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                dailyCapUsdMicro,
                monthlyCapUsdMicro,
              }),
            });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { ok: false; error: { message: string } }
          | null;
        setError(j ? j.error.message : `HTTP ${res.status}`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingFor(null);
    }
  }

  if (members === null) return null;

  const eligible = members.filter((m) => m.role !== "owner");
  if (eligible.length === 0) return null;

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
        Spend caps (workspace org-key)
      </div>
      <div
        style={{
          background: "var(--lb-card)",
          border: "1px solid var(--lb-border)",
          borderRadius: "var(--lb-radius-md)",
          overflow: "hidden",
        }}
      >
        <p
          style={{
            padding: "var(--lb-sp-3) var(--lb-sp-4)",
            fontSize: "var(--lb-fs-sm)",
            color: "var(--lb-muted-fg)",
            margin: 0,
            borderBottom: "1px solid var(--lb-border)",
            lineHeight: 1.5,
          }}
        >
          USD limit (0 = sınırsız). Sadece personal BYOK&apos;ı olmayan
          üyelerin workspace org-key kullanımına uygulanır.
        </p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {eligible.map((m) => {
            const cap = caps.get(m.userId);
            const dailyUsd = cap ? cap.dailyCapUsdMicro / 1_000_000 : 0;
            const monthlyUsd = cap
              ? cap.monthlyCapUsdMicro / 1_000_000
              : 0;
            return (
              <CapRow
                key={m.memberId}
                member={m}
                dailyUsd={dailyUsd}
                monthlyUsd={monthlyUsd}
                saving={savingFor === m.userId}
                onSave={(d, mo) => saveCap(m.userId, d, mo)}
              />
            );
          })}
        </ul>
        {error && (
          <p
            style={{
              padding: "var(--lb-sp-2) var(--lb-sp-4)",
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

function CapRow({
  member,
  dailyUsd: initialDaily,
  monthlyUsd: initialMonthly,
  saving,
  onSave,
}: {
  member: Member;
  dailyUsd: number;
  monthlyUsd: number;
  saving: boolean;
  onSave: (daily: number, monthly: number) => void;
}) {
  const [daily, setDaily] = useState(String(initialDaily));
  const [monthly, setMonthly] = useState(String(initialMonthly));

  const dirty =
    Number(daily) !== initialDaily || Number(monthly) !== initialMonthly;

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--lb-sp-2)",
        padding: "var(--lb-sp-2) var(--lb-sp-4)",
        borderBottom: "1px solid var(--lb-border)",
        fontSize: "var(--lb-fs-sm)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ fontWeight: "var(--lb-fw-medium)" }}>
          {member.user.telegramFirstName}
        </div>
        {member.user.telegramUsername && (
          <div
            style={{
              fontSize: "var(--lb-fs-xs)",
              color: "var(--lb-muted-fg)",
            }}
          >
            @{member.user.telegramUsername}
          </div>
        )}
      </div>
      <Field label="Day" value={daily} onChange={setDaily} />
      <Field label="30d" value={monthly} onChange={setMonthly} />
      <button
        type="button"
        disabled={!dirty || saving}
        onClick={() => onSave(Number(daily) || 0, Number(monthly) || 0)}
        style={{
          background: dirty ? "var(--lb-accent)" : "var(--lb-muted)",
          color: dirty ? "var(--lb-accent-fg)" : "var(--lb-muted-fg)",
          border: "none",
          padding: "var(--lb-sp-1) var(--lb-sp-3)",
          borderRadius: "var(--lb-radius-md)",
          fontSize: "var(--lb-fs-xs)",
          fontWeight: "var(--lb-fw-medium)",
          cursor: !dirty || saving ? "not-allowed" : "pointer",
        }}
      >
        {saving ? "..." : "Kaydet"}
      </button>
    </li>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        color: "var(--lb-muted-fg)",
        fontSize: "var(--lb-fs-xs)",
      }}
    >
      {label}
      <span style={{ color: "var(--lb-muted-fg)" }}>$</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 64,
          background: "var(--lb-bg)",
          color: "var(--lb-fg)",
          border: "1px solid var(--lb-border)",
          borderRadius: "var(--lb-radius-md)",
          padding: "2px 6px",
          fontSize: "var(--lb-fs-xs)",
          fontFamily: "var(--lb-font-mono, monospace)",
        }}
      />
    </label>
  );
}
