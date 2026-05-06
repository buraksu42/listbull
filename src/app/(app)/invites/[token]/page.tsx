import { headers } from "next/headers";

import { InviteAcceptCard } from "@/components/lists/invite-accept-card";
import { EmptyState } from "@/components/shared/empty-state";
import { getSessionUserId } from "@/lib/auth/session";
import { getUserById } from "@/lib/db/queries/users";
import { getInviteContextByToken } from "@/lib/db/queries/invites";
import type { InviteTokenInfo, ListRole } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Invite-accept screen — Phase 3.
 *
 * The route is publicly reachable (the invitee may not yet have a
 * session); the token's 256-bit entropy IS the auth surface (Inv-10).
 *
 * Server-side responsibilities:
 *   - resolve invite info (404 when token missing).
 *   - resolve session (optional).
 *   - compute `currentUserCanAccept` server-side so the client doesn't
 *     re-derive (and disagree).
 *
 * Client-side `<InviteAcceptCard />` handles the POST + MainButton +
 * navigation on success/already-accepted.
 *
 * The token MUST NOT be logged. We don't.
 *
 * Note: we deliberately read invite data via the same server query
 * helper Backend uses (`getInviteContextByToken`) instead of fetching
 * `/api/invites/[token]` server-side. Same data, no extra hop, and the
 * function already lives outside the API surface frontends own.
 */
export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Force a session lookup; required for `headers()` cookie context.
  await headers();

  if (!token || token.length < 16) {
    return (
      <main style={{ paddingTop: "var(--lb-sp-12)" }}>
        <EmptyState
          title="Invite not found"
          description="This invite link is invalid or has been removed."
        />
      </main>
    );
  }

  const ctx = await getInviteContextByToken(token);
  if (!ctx) {
    return (
      <main style={{ paddingTop: "var(--lb-sp-12)" }}>
        <EmptyState
          title="Invite not found"
          description="This invite link is invalid or has been removed."
        />
      </main>
    );
  }

  // Server-rendered page; isExpired computed against request time and
  // re-evaluated by `force-dynamic` on every load.
  const requestTime = new Date();
  const isExpired = ctx.invite.expiresAt.getTime() < requestTime.getTime();
  const isAccepted = ctx.invite.acceptedAt !== null;

  const sessionUserId = await getSessionUserId();
  const currentUser = sessionUserId ? await getUserById(sessionUserId) : null;
  const callerUsernameLower = (currentUser?.telegramUsername ?? "").toLowerCase();
  const usernameMatches =
    callerUsernameLower.length > 0 &&
    callerUsernameLower === ctx.invite.invitedUsername;
  const currentUserCanAccept = !isExpired && !isAccepted && usernameMatches;

  const info: InviteTokenInfo = {
    token: ctx.invite.token,
    listId: ctx.list.id,
    listName: ctx.list.name,
    listEmoji: ctx.list.emoji,
    invitedByName: ctx.invitedByName,
    role: ctx.invite.role as ListRole,
    expiresAt: ctx.invite.expiresAt.toISOString(),
    isExpired,
    isAccepted,
  };

  return (
    <main
      style={{
        padding: "var(--lb-sp-6) var(--lb-sp-4) var(--lb-sp-12)",
        minHeight: "100dvh",
      }}
    >
      <InviteAcceptCard
        invite={info}
        invitedUsername={ctx.invite.invitedUsername}
        isAuthenticated={Boolean(sessionUserId)}
        currentUserCanAccept={currentUserCanAccept}
        usernameMismatch={
          Boolean(sessionUserId) &&
          !isExpired &&
          !isAccepted &&
          !usernameMatches
        }
      />
    </main>
  );
}
