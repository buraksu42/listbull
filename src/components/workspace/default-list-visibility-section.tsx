"use client";

import { useEffect, useState } from "react";

type Visibility = "public" | "private";

type Props = {
  workspaceId: string;
  canManage: boolean;
};

/**
 * Workspace setting: default visibility for newly-created lists.
 *
 * 'public' lists are visible + (role-gated) writable to every
 * workspace member without per-list invites. 'private' lists keep
 * the legacy list_members gate (creator-only until shared).
 *
 * Owner-only setter; non-owners see the current value read-only so
 * they understand the workspace's posture before creating a list.
 */
export function DefaultListVisibilitySection({ workspaceId, canManage }: Props) {
  const [current, setCurrent] = useState<Visibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/default-list-visibility`,
        );
        const json = (await res.json().catch(() => null)) as
          | { ok: true; data: { defaultListVisibility: Visibility } }
          | { ok: false }
          | null;
        if (!cancelled && json && json.ok) {
          setCurrent(json.data.defaultListVisibility);
        }
      } catch {
        // Silent — defaults to "Loading" state UI.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function persist(next: Visibility): Promise<void> {
    if (busy || next === current) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/default-list-visibility`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ defaultListVisibility: next }),
        },
      );
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { defaultListVisibility: Visibility } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        setError(json && "error" in json ? json.error.message : "Save failed");
        return;
      }
      setCurrent(json.data.defaultListVisibility);
      setInfo("Kaydedildi.");
    } catch {
      setError("Bağlantı sorunu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
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
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "var(--lb-sp-2)",
        }}
      >
        <h2
          style={{
            fontSize: "var(--lb-fs-md)",
            fontWeight: "var(--lb-fw-semibold)",
          }}
        >
          Yeni liste varsayılan görünürlüğü
        </h2>
        <span
          style={{
            fontSize: "var(--lb-fs-xs)",
            color: "var(--lb-muted-fg)",
          }}
        >
          {canManage ? "Owner-only" : "Read-only"}
        </span>
      </header>

      <p
        style={{
          fontSize: "var(--lb-fs-sm)",
          color: "var(--lb-muted-fg)",
          lineHeight: 1.5,
        }}
      >
        Public listeler workspace&apos;teki herkese görünür ve (workspace
        rolüne göre) düzenlenebilir. Private listeler sadece list_members
        olarak eklenmiş kullanıcılara açıktır. Bu ayar yalnız <em>yeni</em>{" "}
        oluşturulacak listeleri etkiler.
      </p>

      <div
        style={{
          display: "flex",
          gap: "var(--lb-sp-2)",
        }}
      >
        <RadioOption
          label="🌐 Public"
          description="Workspace üyeleri görür + edit (rolüne göre)"
          checked={current === "public"}
          disabled={!canManage || busy}
          onClick={() => persist("public")}
        />
        <RadioOption
          label="🔒 Private"
          description="Sadece list_members görür"
          checked={current === "private"}
          disabled={!canManage || busy}
          onClick={() => persist("private")}
        />
      </div>

      {info && (
        <p style={{ fontSize: "var(--lb-fs-xs)", color: "var(--lb-accent)" }}>
          {info}
        </p>
      )}
      {error && (
        <p style={{ fontSize: "var(--lb-fs-xs)", color: "var(--lb-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

function RadioOption({
  label,
  description,
  checked,
  disabled,
  onClick,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        textAlign: "left",
        padding: "var(--lb-sp-3)",
        borderRadius: "var(--lb-radius-md)",
        border: checked
          ? "2px solid var(--lb-accent)"
          : "1px solid var(--lb-border)",
        background: checked
          ? "color-mix(in srgb, var(--lb-accent) 8%, transparent)"
          : "transparent",
        color: "var(--lb-fg)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && !checked ? 0.6 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: "var(--lb-fs-sm)",
          fontWeight: "var(--lb-fw-semibold)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "var(--lb-fs-xs)",
          color: "var(--lb-muted-fg)",
        }}
      >
        {description}
      </span>
    </button>
  );
}
