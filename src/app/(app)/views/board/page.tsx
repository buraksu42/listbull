import { LayoutGrid } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { WorkspaceBoard } from "@/components/views/workspace-board";
import { listItemsForWorkspaceBoard } from "@/lib/db/queries/views";
import {
  getWorkspaceMembership,
  listWorkspaceMembers,
  resolveActiveWorkspaceId,
} from "@/lib/db/queries/workspaces";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * Workspace-wide Kanban view. Aggregates open / in-progress / blocked /
 * recently-done items across every list the user can read inside the
 * active workspace, with priority + assignee chip filters. Drag-drop
 * across columns updates `items.status` + `items.position` via the
 * existing PATCH /api/items/[id] route.
 *
 * Distinct from /lists/[id]?view=board (per-list board) — this lives
 * one level up and is the right entry point for "where am I across
 * everything I'm tracking".
 */
export default async function WorkspaceBoardPage() {
  const user = await requireUser();
  const workspaceId = await resolveActiveWorkspaceId(user.id);
  const membership = await getWorkspaceMembership(user.id, workspaceId);

  const [items, members] = await Promise.all([
    listItemsForWorkspaceBoard({ userId: user.id, workspaceId }),
    listWorkspaceMembers(workspaceId),
  ]);

  // Workspace-level write permission: owner/admin/editor can drag.
  // Viewer + guest can't. The server still re-checks per-list write
  // access on PATCH /api/items/[id], so this is a UX gate, not the
  // authorization boundary.
  const canWrite =
    membership !== null &&
    (membership.role === "owner" ||
      membership.role === "admin" ||
      membership.role === "editor");

  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <header
        style={{
          height: "var(--lb-header-h)",
          padding: "0 var(--lb-sp-4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <h1
          style={{
            fontSize: "var(--lb-fs-xl)",
            fontWeight: "var(--lb-fw-semibold)",
          }}
        >
          {user.locale === "tr" ? "Pano" : "Board"}
        </h1>
        <span
          style={{
            color: "var(--lb-muted-fg)",
            fontSize: "var(--lb-fs-sm)",
          }}
        >
          {items.length} {user.locale === "tr" ? "öğe" : "items"}
        </span>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-6 w-6" aria-hidden />}
          title={
            user.locale === "tr"
              ? "Pano boş"
              : "Nothing to board yet"
          }
          description={
            user.locale === "tr"
              ? "Listelerine yeni öğe ekledikçe burada durumlarına göre gruplanır."
              : "Items appear here as you create them across your lists."
          }
        />
      ) : (
        <WorkspaceBoard
          workspaceId={workspaceId}
          initialItems={items}
          initialMembers={members}
          canWrite={canWrite}
        />
      )}
    </main>
  );
}
