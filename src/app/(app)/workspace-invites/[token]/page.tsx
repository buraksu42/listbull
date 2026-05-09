import { EmptyState } from "@/components/shared/empty-state";
import { WorkspaceInviteAccept } from "@/components/workspace/invite-accept";
import { getWorkspaceInviteContextByToken } from "@/lib/db/queries/workspace-invites";
import type { WorkspaceInviteTokenInfo, WorkspaceRole } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Workspace invite accept screen. Reached via Telegram deeplink
 * (`https://t.me/<bot>?startapp=wsinvite_<token>`) → /app boot route
 * routes start_param prefix `wsinvite_` here.
 *
 * Token is public — anyone with the URL can read invite metadata
 * (workspace name, inviter name, expiry) but only the matching
 * Telegram-username caller can accept. The accept POST verifies
 * username on the server.
 */
export default async function WorkspaceInviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!token || token.length < 16) {
    return (
      <main style={{ paddingTop: "var(--lb-sp-12)" }}>
        <EmptyState
          title="Davet bulunamadı"
          description="Bu davet linki geçersiz ya da kaldırılmış."
        />
      </main>
    );
  }

  const ctxRow = await getWorkspaceInviteContextByToken(token);
  if (!ctxRow) {
    return (
      <main style={{ paddingTop: "var(--lb-sp-12)" }}>
        <EmptyState
          title="Davet bulunamadı"
          description="Bu davet linki geçersiz, süresi dolmuş ya da iptal edilmiş olabilir. Davet eden kişiyle iletişime geç."
        />
      </main>
    );
  }

  const now = new Date();
  const info: WorkspaceInviteTokenInfo = {
    token,
    workspaceId: ctxRow.workspace.id,
    workspaceName: ctxRow.workspace.name,
    invitedByName: ctxRow.invitedByName,
    role: ctxRow.invite.role as WorkspaceRole,
    expiresAt: ctxRow.invite.expiresAt.toISOString(),
    isExpired: ctxRow.invite.expiresAt < now,
    isAccepted: ctxRow.invite.acceptedAt !== null,
  };

  return <WorkspaceInviteAccept invite={info} />;
}
