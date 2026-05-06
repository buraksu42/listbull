import { Check } from "lucide-react";
import Link from "next/link";

import { getWorkspaceBillingState } from "@/lib/billing/tier-check";
import { TIER_LIMITS } from "@/lib/types";
import { requireUser } from "@/lib/server/auth/require-user";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";

export const dynamic = "force-dynamic";

/**
 * Stripe Checkout success_url lands here. Reads the latest
 * subscription state (which the webhook handler should have
 * already upserted by the time the user redirects back) and
 * confirms the upgrade.
 *
 * If the webhook hasn't landed yet (network race — Stripe webhook
 * delivery can lag the browser redirect by a few seconds), we
 * show a "processing" state with a meta-refresh.
 */
export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  const params = await searchParams;
  const workspaceId = params.ws;
  if (!workspaceId) {
    return <SuccessShell processing>Missing workspace context.</SuccessShell>;
  }

  const user = await requireUser();
  const membership = await getWorkspaceMembership(user.id, workspaceId);
  if (!membership) {
    return (
      <SuccessShell processing>You don&apos;t belong to that workspace.</SuccessShell>
    );
  }

  const state = await getWorkspaceBillingState(workspaceId);
  const limits = TIER_LIMITS[state.tier];
  const tierLabel =
    state.tier === "team"
      ? "Team"
      : state.tier === "workspace"
        ? "Workspace"
        : "Free";

  if (state.tier === "free") {
    // Webhook hasn't landed yet — render processing state.
    return (
      <SuccessShell processing>
        Ödeme alındı; abonelik durumu birkaç saniye içinde güncellenecek.
      </SuccessShell>
    );
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
        gap: "var(--lb-sp-4)",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background:
            "color-mix(in srgb, var(--lb-success, #2EB872) 18%, transparent)",
          color: "var(--lb-success, #2EB872)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Check width={32} height={32} aria-hidden />
      </div>
      <div>
        <h1
          style={{
            fontSize: "var(--lb-fs-xl)",
            fontWeight: "var(--lb-fw-semibold)",
            margin: 0,
          }}
        >
          {tierLabel} planındasın
        </h1>
        <p
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-sm)",
            marginTop: "var(--lb-sp-2)",
          }}
        >
          {limits.memberLimit} üye, {limits.workspaceCount} workspace.
        </p>
      </div>
      <div style={{ display: "flex", gap: "var(--lb-sp-3)" }}>
        <Link
          href={`/workspace/settings`}
          style={{
            background: "var(--lb-accent)",
            color: "var(--lb-accent-fg)",
            textDecoration: "none",
            padding: "var(--lb-sp-2) var(--lb-sp-4)",
            borderRadius: "var(--lb-radius-md)",
            fontWeight: "var(--lb-fw-medium)",
          }}
        >
          Workspace ayarları
        </Link>
        <Link
          href="/lists"
          style={{
            color: "var(--lb-fg)",
            textDecoration: "none",
            padding: "var(--lb-sp-2) var(--lb-sp-4)",
            borderRadius: "var(--lb-radius-md)",
            border: "1px solid var(--lb-border)",
          }}
        >
          Listelere dön
        </Link>
      </div>
    </main>
  );
}

function SuccessShell({
  processing,
  children,
}: {
  processing: boolean;
  children: React.ReactNode;
}) {
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
        gap: "var(--lb-sp-3)",
      }}
    >
      {processing && (
        <meta httpEquiv="refresh" content="3" />
      )}
      <p style={{ color: "var(--lb-muted-fg)" }}>{children}</p>
      {processing && (
        <p
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-xs)",
          }}
        >
          (Sayfa otomatik yenilenecek)
        </p>
      )}
      <Link
        href="/workspace/settings"
        style={{
          color: "var(--lb-accent)",
          textDecoration: "none",
        }}
      >
        Workspace ayarları
      </Link>
    </main>
  );
}
