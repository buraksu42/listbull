"use client";

import { useEffect, useState } from "react";

type SubscriptionState = {
  tier: "free" | "team" | "workspace";
  status: "active" | "past_due" | "canceled" | "trialing";
  pastDueLocked: boolean;
};

type Props = {
  workspaceId: string;
};

/**
 * Past-due banner. Polls /api/billing/subscription every 60s. When
 * status='past_due' but pastDueLocked is false, shows the warning
 * banner with a CTA to update payment. When pastDueLocked is true,
 * the banner switches to red and the workspace is read-only — the
 * tier middleware (Phase 5 BILLING_ENFORCE=true) blocks mutations.
 *
 * Hidden when status='active' / 'trialing' (no banner is the
 * default).
 */
export function PastDueBanner({ workspaceId }: Props) {
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchState() {
      try {
        const res = await fetch(
          `/api/billing/subscription?workspaceId=${encodeURIComponent(workspaceId)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as
          | { ok: true; data: SubscriptionState & { limits: unknown } }
          | { ok: false };
        if (!cancelled && json.ok) {
          setState({
            tier: json.data.tier,
            status: json.data.status,
            pastDueLocked: json.data.pastDueLocked,
          });
        }
      } catch {
        // Silent — banner just stays hidden.
      }
    }
    void fetchState();
    const interval = setInterval(fetchState, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workspaceId]);

  if (!state || state.status !== "past_due") return null;

  const locked = state.pastDueLocked;
  const palette = locked
    ? {
        background:
          "color-mix(in srgb, var(--lb-destructive, #D72D40) 12%, transparent)",
        color: "var(--lb-destructive, #D72D40)",
        border: "1px solid var(--lb-destructive, #D72D40)",
      }
    : {
        background:
          "color-mix(in srgb, var(--lb-warning, #F0A020) 12%, transparent)",
        color: "var(--lb-warning, #F0A020)",
        border: "1px solid var(--lb-warning, #F0A020)",
      };

  async function openPortal() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { url: string } }
        | { ok: false; error: { message: string } }
        | null;
      if (json && json.ok) {
        window.location.href = json.data.url;
      } else {
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  }

  return (
    <div
      role="alert"
      style={{
        ...palette,
        padding: "var(--lb-sp-3) var(--lb-sp-4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--lb-sp-3)",
        fontSize: "var(--lb-fs-sm)",
      }}
    >
      <span>
        {locked ? (
          <>
            <strong>Workspace read-only.</strong> Ödeme yöntemini güncelle.
          </>
        ) : (
          <>
            <strong>Ödeme başarısız.</strong> 7 gün içinde güncellenmezse
            workspace read-only moda geçer.
          </>
        )}
      </span>
      <button
        type="button"
        onClick={openPortal}
        disabled={busy}
        style={{
          background: "transparent",
          color: "inherit",
          border: "1px solid currentColor",
          padding: "var(--lb-sp-1) var(--lb-sp-3)",
          borderRadius: "var(--lb-radius-md)",
          fontSize: "var(--lb-fs-xs)",
          fontWeight: "var(--lb-fw-medium)",
          cursor: busy ? "wait" : "pointer",
          flexShrink: 0,
        }}
      >
        {busy ? "Açılıyor…" : "Ödemeyi güncelle"}
      </button>
    </div>
  );
}
