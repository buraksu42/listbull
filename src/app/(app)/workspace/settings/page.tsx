import { ChevronLeft, Crown } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CustomBotSection } from "@/components/workspace/custom-bot-section";
import { DefaultListVisibilitySection } from "@/components/workspace/default-list-visibility-section";
import { LlmModelSection } from "@/components/workspace/llm-model-section";
import { MembersSection } from "@/components/workspace/members-section";
import { OrgKeySection } from "@/components/workspace/org-key-section";
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

        <MembersSection
          workspaceId={active.id}
          isOwner={active.role === "owner"}
          isOwnerOrAdmin={
            active.role === "owner" || active.role === "admin"
          }
          isPersonal={active.isPersonal}
        />

        <CustomBotSection
          workspaceId={active.id}
          canManage={active.role === "owner"}
        />

        <OrgKeySection
          workspaceId={active.id}
          canManage={active.role === "owner" || active.role === "admin"}
        />

        <LlmModelSection
          workspaceId={active.id}
          canManage={active.role === "owner"}
        />

        <DefaultListVisibilitySection
          workspaceId={active.id}
          canManage={active.role === "owner"}
        />

        {(active.role === "owner" || active.role === "admin") && (
            <Link
              href="/workspace/admin"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--lb-sp-3)",
                padding: "var(--lb-sp-3) var(--lb-sp-4)",
                background: "var(--lb-card)",
                border: "1px solid var(--lb-border)",
                borderRadius: "var(--lb-radius-md)",
                color: "var(--lb-fg)",
                textDecoration: "none",
                fontSize: "var(--lb-fs-sm)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--lb-sp-2)",
                  fontWeight: "var(--lb-fw-medium)",
                }}
              >
                <Crown
                  width={14}
                  height={14}
                  aria-hidden
                  style={{ color: "var(--lb-accent)" }}
                />
                Admin dashboard
              </span>
              <span style={{ color: "var(--lb-muted-fg)" }}>→</span>
            </Link>
          )}
      </div>
    </main>
  );
}
