"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import type { WorkspaceInviteTokenInfo } from "@/lib/types";

type Props = {
  invite: WorkspaceInviteTokenInfo;
};

const TIER_LABEL: Record<string, string> = {
  free: "Free",
  team: "Team",
  workspace: "Workspace",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  guest: "Guest",
};

/**
 * Workspace invite accept card. POSTs to
 * /api/workspace-invites/[token]; on success, redirects to /lists
 * (the new workspace becomes the active one in the same call).
 */
export function WorkspaceInviteAccept({ invite }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const blocked = invite.isExpired || invite.isAccepted;

  async function accept() {
    if (blocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace-invites/${invite.token}`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { workspaceId: string; alreadyAccepted: boolean } }
        | { ok: false; error: { code: string; message: string } }
        | null;

      if (!res.ok || !json || !json.ok) {
        setError(json && !json.ok ? json.error.message : `HTTP ${res.status}`);
        setBusy(false);
        return;
      }

      setDone(true);
      // Brief success state, then bounce to /lists.
      setTimeout(() => {
        window.location.replace("/lists");
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "calc(100dvh - var(--lb-header-h))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--lb-sp-6)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: 380,
          width: "100%",
          background: "var(--lb-card)",
          border: "1px solid var(--lb-border)",
          borderRadius: "var(--lb-radius-md)",
          padding: "var(--lb-sp-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-4)",
        }}
      >
        {done ? (
          <>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                margin: "0 auto",
                background:
                  "color-mix(in srgb, var(--lb-success, #2EB872) 18%, transparent)",
                color: "var(--lb-success, #2EB872)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Check width={28} height={28} aria-hidden />
            </div>
            <p
              style={{
                fontSize: "var(--lb-fs-base)",
                fontWeight: "var(--lb-fw-semibold)",
                margin: 0,
              }}
            >
              {invite.workspaceName} workspace&apos;ine katıldın.
            </p>
            <p
              style={{
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-sm)",
                margin: 0,
              }}
            >
              Listelere yönlendiriliyorsun…
            </p>
          </>
        ) : (
          <>
            <h1
              style={{
                fontSize: "var(--lb-fs-xl)",
                fontWeight: "var(--lb-fw-semibold)",
                margin: 0,
              }}
            >
              {invite.workspaceName}
            </h1>
            <p
              style={{
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-sm)",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              {invite.invitedByName} seni bu workspace&apos;e davet etti.
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--lb-sp-2)",
                fontSize: "var(--lb-fs-sm)",
                color: "var(--lb-muted-fg)",
                paddingBlock: "var(--lb-sp-2)",
                borderTop: "1px solid var(--lb-border)",
                borderBottom: "1px solid var(--lb-border)",
              }}
            >
              <div>
                Plan:{" "}
                <span style={{ color: "var(--lb-fg)" }}>
                  {TIER_LABEL[invite.workspaceTier] ?? invite.workspaceTier}
                </span>
              </div>
              <div>
                Rol:{" "}
                <span style={{ color: "var(--lb-fg)" }}>
                  {ROLE_LABEL[invite.role] ?? invite.role}
                </span>
              </div>
            </div>

            {invite.isExpired && (
              <p
                style={{
                  color: "var(--lb-destructive, #D72D40)",
                  fontSize: "var(--lb-fs-sm)",
                  margin: 0,
                }}
              >
                Bu davet süresi dolmuş.
              </p>
            )}
            {invite.isAccepted && (
              <p
                style={{
                  color: "var(--lb-muted-fg)",
                  fontSize: "var(--lb-fs-sm)",
                  margin: 0,
                }}
              >
                Bu davet zaten kabul edildi.
              </p>
            )}

            <button
              type="button"
              disabled={blocked || busy}
              onClick={accept}
              style={{
                background: "var(--lb-accent)",
                color: "var(--lb-accent-fg)",
                border: "none",
                padding: "var(--lb-sp-3) var(--lb-sp-5)",
                borderRadius: "var(--lb-radius-md)",
                fontWeight: "var(--lb-fw-medium)",
                fontSize: "var(--lb-fs-base)",
                cursor: blocked || busy ? "not-allowed" : "pointer",
                opacity: blocked || busy ? 0.6 : 1,
              }}
            >
              {busy ? "Kabul ediliyor…" : "Daveti kabul et"}
            </button>
            {error && (
              <p
                style={{
                  color: "var(--lb-destructive, #D72D40)",
                  fontSize: "var(--lb-fs-xs)",
                  margin: 0,
                }}
                role="alert"
              >
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
