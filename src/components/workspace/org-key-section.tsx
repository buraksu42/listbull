"use client";

import { useEffect, useState, type FormEvent } from "react";

type Props = {
  workspaceId: string;
  /** Owner / admin only — non-managers see read-only "set / not set" status. */
  canManage: boolean;
  /** Workspace-tier gate — non-Workspace tier hides the form. */
  isWorkspaceTier: boolean;
};

/**
 * Workspace org-level OpenRouter key (Phase 5.5 / G6).
 *
 * Workspace-tier admins can paste a workspace-wide OpenRouter key.
 * Members without personal BYOK fall back to it during LLM calls.
 * Never displays the key itself — only "set / not set" + a Replace
 * / Clear affordance.
 */
export function OrgKeySection({
  workspaceId,
  canManage,
  isWorkspaceTier,
}: Props) {
  const [hasOrgKey, setHasOrgKey] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/org-key`);
        if (!res.ok) {
          if (!cancelled) setHasOrgKey(false);
          return;
        }
        const json = (await res.json().catch(() => null)) as
          | { ok: true; data: { hasOrgKey: boolean } }
          | { ok: false }
          | null;
        if (!cancelled && json && json.ok) setHasOrgKey(json.data.hasOrgKey);
      } catch {
        if (!cancelled) setHasOrgKey(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function onSet(e: FormEvent) {
    e.preventDefault();
    if (busy || !apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/org-key`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { hasOrgKey: boolean } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        setError(json && !json.ok ? json.error.message : `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      setHasOrgKey(true);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (
      !window.confirm(
        "Workspace API key kaldırılacak. Personal BYOK'ı olmayan üyeler operator fallback'ine düşecek (yoksa hata alır). Devam?",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/org-key`, {
        method: "DELETE",
      });
      if (res.ok) setHasOrgKey(false);
    } finally {
      setBusy(false);
    }
  }

  if (!isWorkspaceTier) {
    // Hide the section entirely on Free/Team — too noisy to show
    // "upgrade to use." Tier upgrade lives elsewhere on the page.
    return null;
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
        Workspace API key
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
        <p
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-sm)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Workspace üyelerinin personal BYOK&apos;ları yoksa LLM çağrıları
          bu key&apos;e düşer. AES-256-GCM ile encrypted saklanır; geri
          okunamaz, yalnızca değiştirilir veya silinir.
        </p>

        <div
          style={{
            fontSize: "var(--lb-fs-sm)",
          }}
        >
          Durum:{" "}
          {hasOrgKey === null ? (
            <span style={{ color: "var(--lb-muted-fg)" }}>Yükleniyor…</span>
          ) : hasOrgKey ? (
            <span style={{ color: "var(--lb-success, #2EB872)" }}>
              ✓ Kayıtlı
            </span>
          ) : (
            <span style={{ color: "var(--lb-muted-fg)" }}>Kayıtlı değil</span>
          )}
        </div>

        {canManage && (
          <>
            <form
              onSubmit={onSet}
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
                {hasOrgKey ? "Yeni key (replace)" : "OpenRouter API key"}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
                style={{
                  background: "var(--lb-bg)",
                  color: "var(--lb-fg)",
                  border: "1px solid var(--lb-border)",
                  borderRadius: "var(--lb-radius-md)",
                  padding: "var(--lb-sp-2) var(--lb-sp-3)",
                  fontSize: "var(--lb-fs-sm)",
                  fontFamily: "var(--lb-font-mono, monospace)",
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--lb-sp-3)",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="submit"
                  disabled={busy || !apiKey.trim()}
                  style={{
                    background: "var(--lb-accent)",
                    color: "var(--lb-accent-fg)",
                    border: "none",
                    padding: "var(--lb-sp-2) var(--lb-sp-4)",
                    borderRadius: "var(--lb-radius-md)",
                    fontWeight: "var(--lb-fw-medium)",
                    fontSize: "var(--lb-fs-sm)",
                    cursor:
                      busy || !apiKey.trim() ? "not-allowed" : "pointer",
                    opacity: busy || !apiKey.trim() ? 0.6 : 1,
                  }}
                >
                  {busy ? "Kaydediliyor…" : hasOrgKey ? "Değiştir" : "Kaydet"}
                </button>
                {hasOrgKey && (
                  <button
                    type="button"
                    onClick={onClear}
                    disabled={busy}
                    style={{
                      background: "transparent",
                      color: "var(--lb-destructive, #D72D40)",
                      border: "1px solid currentColor",
                      padding: "var(--lb-sp-2) var(--lb-sp-3)",
                      borderRadius: "var(--lb-radius-md)",
                      fontSize: "var(--lb-fs-sm)",
                      cursor: busy ? "wait" : "pointer",
                    }}
                  >
                    Sil
                  </button>
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
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
