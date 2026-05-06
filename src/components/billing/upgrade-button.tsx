"use client";

import { useState } from "react";

type Props = {
  workspaceId: string;
  /** Target tier — what the upgrade flow purchases. */
  tier: "team" | "workspace";
  /** Display label override; defaults to "Upgrade to <Tier>". */
  label?: string;
  /** Render a primary (filled) or secondary (outline) button. */
  variant?: "primary" | "secondary";
  /** Disable when the workspace is already on this or higher tier. */
  disabled?: boolean;
};

/**
 * Upgrade button — POSTs to /api/billing/checkout with the target
 * tier, redirects the browser to the Stripe Checkout URL on success.
 *
 * Phase 5 client-side surface for the tier upgrade flow. Stripe
 * Checkout opens out-of-Mini-App on most clients (Telegram opens
 * external browser); on success/cancel the user is bounced back via
 * the success_url / cancel_url configured on the session
 * (/billing/success?ws=<id> and /workspace/settings respectively).
 */
export function UpgradeButton({
  workspaceId,
  tier,
  label,
  variant = "primary",
  disabled = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (disabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, tier }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { url: string | null } }
        | { ok: false; error: { code: string; message: string } }
        | null;

      if (!res.ok || !json || !json.ok) {
        const msg =
          json && !json.ok
            ? json.error.message
            : `HTTP ${res.status}`;
        setError(msg);
        setBusy(false);
        return;
      }

      if (!json.data.url) {
        setError("Checkout URL missing.");
        setBusy(false);
        return;
      }

      window.location.href = json.data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const baseStyle = {
    border: "none",
    padding: "var(--lb-sp-2) var(--lb-sp-4)",
    borderRadius: "var(--lb-radius-md)",
    fontWeight: "var(--lb-fw-medium)",
    fontSize: "var(--lb-fs-sm)",
    cursor: disabled || busy ? "not-allowed" : "pointer",
    opacity: disabled || busy ? 0.6 : 1,
  } as const;

  const palette =
    variant === "primary"
      ? {
          background: "var(--lb-accent)",
          color: "var(--lb-accent-fg)",
        }
      : {
          background: "transparent",
          color: "var(--lb-fg)",
          border: "1px solid var(--lb-border)",
        };

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={go}
        disabled={disabled || busy}
        style={{ ...baseStyle, ...palette }}
      >
        {busy
          ? "Redirecting…"
          : (label ?? `Upgrade to ${tier === "team" ? "Team" : "Workspace"}`)}
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
    </div>
  );
}
