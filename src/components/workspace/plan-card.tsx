/**
 * PlanCard — workspace settings tier display + member usage bar +
 * upgrade CTA. Phase 4.5 ships read-only; Phase 5 wires the upgrade
 * flow to /api/billing/checkout.
 */
import type { WorkspaceListItem } from "@/lib/types";
import { TIER_LIMITS } from "@/lib/types";

type Props = {
  workspace: WorkspaceListItem;
};

export function PlanCard({ workspace }: Props) {
  const limits = TIER_LIMITS[workspace.tier];
  const usagePct = Math.min(
    100,
    Math.round((workspace.memberCount / limits.memberLimit) * 100),
  );
  const tierLabel =
    workspace.tier === "free"
      ? "Free"
      : workspace.tier === "team"
        ? "Team"
        : "Workspace";

  return (
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "var(--lb-fs-xs)",
              color: "var(--lb-muted-fg)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Current plan
          </div>
          <div
            style={{
              fontSize: "var(--lb-fs-xl)",
              fontWeight: "var(--lb-fw-semibold)",
            }}
          >
            {tierLabel}
          </div>
        </div>
        {workspace.tier === "free" && (
          <button
            type="button"
            disabled
            title="Available in Phase 5"
            style={{
              background: "var(--lb-accent)",
              color: "var(--lb-accent-fg)",
              border: "none",
              padding: "var(--lb-sp-2) var(--lb-sp-4)",
              borderRadius: "var(--lb-radius-md)",
              fontWeight: "var(--lb-fw-medium)",
              fontSize: "var(--lb-fs-sm)",
              cursor: "not-allowed",
              opacity: 0.6,
            }}
          >
            Upgrade
          </button>
        )}
      </div>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "var(--lb-fs-sm)",
            marginBottom: "var(--lb-sp-2)",
          }}
        >
          <span style={{ color: "var(--lb-muted-fg)" }}>Members</span>
          <span>
            {workspace.memberCount} / {limits.memberLimit}
          </span>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: "999px",
            background: "var(--lb-muted)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${usagePct}%`,
              height: "100%",
              background: usagePct >= 80 ? "var(--lb-warning, #F0A020)" : "var(--lb-accent)",
              transition: "width 200ms ease",
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-1)",
          fontSize: "var(--lb-fs-sm)",
          color: "var(--lb-muted-fg)",
        }}
      >
        <div>Up to {limits.memberLimit} member(s)</div>
        <div>Up to {limits.workspaceCount} workspace(s)</div>
        <div>
          {limits.activityRetentionDays === -1
            ? "Unlimited activity log"
            : `${limits.activityRetentionDays} days activity log`}
        </div>
      </div>
    </div>
  );
}
