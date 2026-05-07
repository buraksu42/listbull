import { ChevronLeft, Crown } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ActivityTimeline } from "@/components/workspace/activity-timeline";
import { BulkRestoreSection } from "@/components/workspace/bulk-restore-section";
import { CapsSection } from "@/components/workspace/caps-section";
import { SpendSection } from "@/components/workspace/spend-section";
import {
  listWorkspacesForUser,
  resolveActiveWorkspaceId,
} from "@/lib/db/queries/workspaces";
import { getWorkspaceStats } from "@/lib/db/queries/workspace-stats";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * Workspace admin dashboard (Phase 6). Workspace-tier owner +
 * admin only. Surfaces:
 *   - Headline stats: members, lists, items (open/done), activity
 *     volume (last 30 days)
 *   - License key visibility for self-host operators (TBD; for SaaS
 *     this section is hidden)
 *
 * Lower-traffic surface — server-rendered with no skeleton; cheap
 * enough that a fresh DB read per pageview is fine.
 */
export default async function WorkspaceAdminPage() {
  const user = await requireUser();
  const activeId = await resolveActiveWorkspaceId(user.id);
  const workspaces = await listWorkspacesForUser(user.id);
  const active = workspaces.find((w) => w.id === activeId);
  if (!active) notFound();

  // Tier + role gates. Workspace-tier admin/owner only.
  if (active.tier !== "workspace") {
    redirect("/workspace/settings");
  }
  if (active.role !== "owner" && active.role !== "admin") {
    redirect("/workspace/settings");
  }

  const stats = await getWorkspaceStats(activeId);

  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <header
        style={{
          height: "var(--lb-header-h)",
          padding: "0 var(--lb-sp-3)",
          display: "flex",
          alignItems: "center",
          gap: "var(--lb-sp-2)",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <Link
          href="/workspace/settings"
          aria-label="Back"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            color: "var(--lb-fg)",
          }}
        >
          <ChevronLeft width={20} height={20} aria-hidden />
        </Link>
        <h1
          style={{
            fontSize: "var(--lb-fs-lg)",
            fontWeight: "var(--lb-fw-semibold)",
            display: "flex",
            alignItems: "center",
            gap: "var(--lb-sp-2)",
          }}
        >
          <Crown
            width={16}
            height={16}
            aria-hidden
            style={{ color: "var(--lb-accent)" }}
          />
          Admin · {active.name}
        </h1>
      </header>

      <div
        style={{
          padding: "var(--lb-sp-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-5)",
        }}
      >
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
            Usage
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "var(--lb-sp-3)",
            }}
          >
            <StatCard label="Members" value={stats.memberCount} />
            <StatCard label="Lists" value={stats.listCount} />
            <StatCard label="Items (open)" value={stats.openItemCount} />
            <StatCard label="Items (done)" value={stats.doneItemCount} />
            <StatCard
              label="Activity (30d)"
              value={stats.activityLast30d}
            />
          </div>
        </section>

        <SpendSection workspaceId={activeId} />

        <CapsSection workspaceId={activeId} />

        <ActivityTimeline workspaceId={activeId} />

        {active.role === "owner" && (
          <BulkRestoreSection workspaceId={activeId} />
        )}

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
            About this workspace
          </div>
          <div
            style={{
              background: "var(--lb-card)",
              border: "1px solid var(--lb-border)",
              borderRadius: "var(--lb-radius-md)",
              padding: "var(--lb-sp-3) var(--lb-sp-4)",
              fontSize: "var(--lb-fs-sm)",
              color: "var(--lb-muted-fg)",
              lineHeight: 1.6,
            }}
          >
            <p style={{ margin: 0 }}>
              Tier: <strong style={{ color: "var(--lb-fg)" }}>Workspace</strong>
            </p>
            <p style={{ margin: 0 }}>
              Your role: <strong style={{ color: "var(--lb-fg)", textTransform: "capitalize" }}>{active.role}</strong>
            </p>
            <p
              style={{
                margin: "var(--lb-sp-2) 0 0",
                fontSize: "var(--lb-fs-xs)",
              }}
            >
              Yöneticiler workspace ayarlarından üye davet edebilir, rol
              değiştirebilir, custom bot bağlayabilir, workspace API
              key&apos;i ayarlayabilir.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div
      style={{
        background: "var(--lb-card)",
        border: "1px solid var(--lb-border)",
        borderRadius: "var(--lb-radius-md)",
        padding: "var(--lb-sp-3) var(--lb-sp-4)",
      }}
    >
      <div
        style={{
          fontSize: "var(--lb-fs-xs)",
          color: "var(--lb-muted-fg)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "var(--lb-fs-2xl, 28px)",
          fontWeight: "var(--lb-fw-semibold)",
          marginTop: 2,
        }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
