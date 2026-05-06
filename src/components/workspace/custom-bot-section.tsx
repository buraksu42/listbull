"use client";

import { useEffect, useState, type FormEvent } from "react";

type WorkspaceBot = {
  botId: string;
  telegramBotId: number;
  username: string;
  isDefault: boolean;
  isPrimary: boolean;
  boundAt: string;
};

type Props = {
  workspaceId: string;
  /** Owner-only register form is hidden for non-owners. */
  canManage: boolean;
  /** Workspace-tier gate — non-Workspace tier shows upgrade hint. */
  isWorkspaceTier: boolean;
};

/**
 * Workspace settings → "Custom bot" section. Phase 5 deliverable.
 *
 * Lists the workspace's bound bots (default platform bot + any
 * white-label bot the owner has registered). Workspace-tier owners
 * see a paste-token form; sub-tier shows an upgrade hint.
 */
export function CustomBotSection({
  workspaceId,
  canManage,
  isWorkspaceTier,
}: Props) {
  const [bots, setBots] = useState<WorkspaceBot[] | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/bots`);
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { bots: WorkspaceBot[] } }
        | { ok: false }
        | null;
      if (json && json.ok) setBots(json.data.bots);
    } catch {
      // Silent — UI stays at "Yükleniyor…"
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/bots`);
        const json = (await res.json().catch(() => null)) as
          | { ok: true; data: { bots: WorkspaceBot[] } }
          | { ok: false }
          | null;
        if (!cancelled && json && json.ok) setBots(json.data.bots);
      } catch {
        // Silent — UI stays at "Yükleniyor…"
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    if (busy || !token.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/bots/register`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: token.trim() }),
        },
      );
      const json = (await res.json().catch(() => null)) as
        | {
            ok: true;
            data: {
              bot: { username: string };
              webhookSet: boolean;
              webhookError: string | null;
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

      const msg = json.data.webhookSet
        ? `@${json.data.bot.username} bağlandı, webhook hazır.`
        : `@${json.data.bot.username} kaydedildi ama webhook ayarlanamadı: ${json.data.webhookError ?? "?"}`;
      setSuccess(msg);
      setToken("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(botId: string) {
    if (
      !window.confirm(
        "Bu bot'u workspace'ten kaldıracaksın. Webhook detach edilecek. Devam?",
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/bots/${botId}`,
        { method: "DELETE" },
      );
      if (res.ok) await refresh();
    } catch {
      // Silent.
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
        Custom bot
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
        {bots === null ? (
          <p style={{ color: "var(--lb-muted-fg)", fontSize: "var(--lb-fs-sm)" }}>
            Yükleniyor…
          </p>
        ) : bots.length === 0 ? (
          <p style={{ color: "var(--lb-muted-fg)", fontSize: "var(--lb-fs-sm)" }}>
            Henüz bot bağlı değil.
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
            {bots.map((b) => (
              <li
                key={b.botId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--lb-sp-3)",
                  padding: "var(--lb-sp-2) 0",
                  borderBottom: "1px solid var(--lb-border)",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "var(--lb-fs-base)",
                      fontWeight: "var(--lb-fw-medium)",
                    }}
                  >
                    @{b.username}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--lb-fs-xs)",
                      color: "var(--lb-muted-fg)",
                    }}
                  >
                    {b.isDefault
                      ? "Platform bot"
                      : b.isPrimary
                        ? "White-label · primary"
                        : "White-label"}
                  </div>
                </div>
                {!b.isDefault && canManage && (
                  <button
                    type="button"
                    onClick={() => onRevoke(b.botId)}
                    style={{
                      background: "transparent",
                      color: "var(--lb-destructive, #D72D40)",
                      border: "1px solid currentColor",
                      padding: "var(--lb-sp-1) var(--lb-sp-3)",
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

        {canManage && isWorkspaceTier && (
          <form
            onSubmit={onRegister}
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
              BotFather token (örn 123456:ABC-DEF...)
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:..."
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
                gap: "var(--lb-sp-3)",
                alignItems: "center",
              }}
            >
              <button
                type="submit"
                disabled={busy || !token.trim()}
                style={{
                  background: "var(--lb-accent)",
                  color: "var(--lb-accent-fg)",
                  border: "none",
                  padding: "var(--lb-sp-2) var(--lb-sp-4)",
                  borderRadius: "var(--lb-radius-md)",
                  fontWeight: "var(--lb-fw-medium)",
                  fontSize: "var(--lb-fs-sm)",
                  cursor:
                    busy || !token.trim() ? "not-allowed" : "pointer",
                  opacity: busy || !token.trim() ? 0.6 : 1,
                }}
              >
                {busy ? "Kaydediliyor…" : "Kaydet"}
              </button>
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
              {success && (
                <span
                  style={{
                    color: "var(--lb-success, #2EB872)",
                    fontSize: "var(--lb-fs-xs)",
                  }}
                >
                  {success}
                </span>
              )}
            </div>
          </form>
        )}

        {canManage && !isWorkspaceTier && (
          <div
            style={{
              borderTop: "1px solid var(--lb-border)",
              paddingTop: "var(--lb-sp-3)",
              fontSize: "var(--lb-fs-sm)",
              color: "var(--lb-muted-fg)",
            }}
          >
            Custom bot sadece Workspace planında. Workspace plana geçince
            BotFather token&apos;ı yapıştırarak kendi botunu bağlayabilirsin.
          </div>
        )}
      </div>
    </section>
  );
}
