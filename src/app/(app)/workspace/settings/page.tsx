import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CustomBotSection } from "@/components/workspace/custom-bot-section";
import { OrgKeySection } from "@/components/workspace/org-key-section";
import { PlanCard } from "@/components/workspace/plan-card";
import {
  listWorkspacesForUser,
  resolveActiveWorkspaceId,
} from "@/lib/db/queries/workspaces";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * Workspace settings page — shows the active workspace's plan card,
 * member usage bar, and (Phase 5+) admin controls. For now just the
 * plan card + read-only fields; member management UI lands in
 * Phase 5 alongside white-label bot registration.
 */
export default async function WorkspaceSettingsPage() {
  const user = await requireUser();
  const activeId = await resolveActiveWorkspaceId(user.id);
  const workspaces = await listWorkspacesForUser(user.id);
  const active = workspaces.find((w) => w.id === activeId);
  if (!active) notFound();

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
          href="/lists"
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
          }}
        >
          Workspace settings
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
            General
          </div>
          <div
            style={{
              background: "var(--lb-card)",
              border: "1px solid var(--lb-border)",
              borderRadius: "var(--lb-radius-md)",
              padding: "var(--lb-sp-3) var(--lb-sp-4)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--lb-sp-2)",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "var(--lb-fs-xs)",
                  color: "var(--lb-muted-fg)",
                }}
              >
                Name
              </div>
              <div
                style={{
                  fontSize: "var(--lb-fs-base)",
                  fontWeight: "var(--lb-fw-medium)",
                }}
              >
                {active.name}
                {active.isPersonal && (
                  <span
                    style={{
                      marginLeft: "var(--lb-sp-2)",
                      color: "var(--lb-muted-fg)",
                      fontSize: "var(--lb-fs-xs)",
                    }}
                  >
                    Personal
                  </span>
                )}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: "var(--lb-fs-xs)",
                  color: "var(--lb-muted-fg)",
                }}
              >
                Your role
              </div>
              <div
                style={{
                  fontSize: "var(--lb-fs-base)",
                  textTransform: "capitalize",
                }}
              >
                {active.role}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: "var(--lb-fs-xs)",
                  color: "var(--lb-muted-fg)",
                }}
              >
                Lists
              </div>
              <div style={{ fontSize: "var(--lb-fs-base)" }}>
                {active.listCount}
              </div>
            </div>
          </div>
        </section>

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
            Plan & billing
          </div>
          <PlanCard workspace={active} />
        </section>

        <CustomBotSection
          workspaceId={active.id}
          canManage={active.role === "owner"}
          isWorkspaceTier={active.tier === "workspace"}
        />

        <OrgKeySection
          workspaceId={active.id}
          canManage={active.role === "owner" || active.role === "admin"}
          isWorkspaceTier={active.tier === "workspace"}
        />

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
            Coming next
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--lb-sp-2)",
              fontSize: "var(--lb-fs-sm)",
              color: "var(--lb-muted-fg)",
            }}
          >
            <li>• Workspace member invitations + role management UI</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
