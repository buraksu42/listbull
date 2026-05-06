"use client";

import { Calendar, CheckCircle2, Clock, ShieldAlert, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useTelegramMainButton } from "@/hooks/use-telegram-main-button";
import { ApiError, apiPost } from "@/lib/api-client";
import type { InviteTokenInfo } from "@/lib/types";
import type { AcceptInviteResponse } from "@/lib/validators/invites";

/**
 * Invite-accept card — Phase 3 client surface.
 *
 * State machine (selected by props from the server-side page):
 *   - "accept"     pending + currentUserCanAccept ⇒ MainButton "Accept" → POST /accept
 *   - "guest"      pending + not authenticated ⇒ instruct to open via Telegram bot
 *   - "mismatch"   pending + auth + lower(callerUsername) !== invitedUsername (Inv-14)
 *   - "accepted"   already accepted ⇒ "you're already in" + button to /lists/{id}
 *   - "expired"    past expires_at
 *
 * On success the accept POST returns `{ listId, alreadyAccepted? }` and
 * we navigate via `window.location.replace` (per spec) so back-button
 * doesn't return to the now-stale invite page.
 */
type Props = {
  invite: InviteTokenInfo;
  invitedUsername: string;
  isAuthenticated: boolean;
  currentUserCanAccept: boolean;
  usernameMismatch: boolean;
};

/** P2-2: consume Backend-published response shape directly. */
type AcceptResponse = AcceptInviteResponse;

export function InviteAcceptCard({
  invite,
  invitedUsername,
  isAuthenticated,
  currentUserCanAccept,
  usernameMismatch,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  const accept = React.useCallback(async () => {
    setSubmitting(true);
    try {
      const data = await apiPost<AcceptResponse>(
        `/api/invites/${invite.token}/accept`,
        {},
      );
      // Hard navigate so the user's back button doesn't drop them back
      // onto the (now stale) invite screen.
      window.location.replace(`/lists/${data.listId}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "unknown";
      // The 409 / mismatch code-paths route through the server-rendered
      // states above; if we're here something else went wrong.
      if (code === "invite_already_accepted") {
        toast.message("You're already in this list.");
        router.replace(`/lists/${invite.listId}`);
        return;
      }
      toast.error(acceptErrorCopy(code));
      setSubmitting(false);
    }
  }, [invite.listId, invite.token, router]);

  const acceptFromMainButton = React.useCallback(() => {
    void accept();
  }, [accept]);

  const showAccept =
    !invite.isExpired && !invite.isAccepted && currentUserCanAccept;

  useTelegramMainButton({
    visible: showAccept,
    text: "Accept invite",
    onClick: acceptFromMainButton,
    disabled: submitting,
    loading: submitting,
  });

  // ─── render branches ───────────────────────────────────────────────
  if (invite.isAccepted) {
    return (
      <Card>
        <Headline emoji={invite.listEmoji} listName={invite.listName} />
        <Icon icon={<CheckCircle2 className="h-6 w-6" aria-hidden />} tone="success" />
        <Title>You&apos;re already in this list</Title>
        <Body>
          <Button
            type="button"
            onClick={() => router.replace(`/lists/${invite.listId}`)}
          >
            Open {invite.listName}
          </Button>
        </Body>
      </Card>
    );
  }

  if (invite.isExpired) {
    return (
      <Card>
        <Headline emoji={invite.listEmoji} listName={invite.listName} />
        <Icon icon={<Clock className="h-6 w-6" aria-hidden />} tone="muted" />
        <Title>This invite expired</Title>
        <Subtitle>
          {`Expired on ${formatExpiry(invite.expiresAt)}. Ask ${invite.invitedByName} to send a new one.`}
        </Subtitle>
      </Card>
    );
  }

  if (!isAuthenticated) {
    return (
      <Card>
        <Headline emoji={invite.listEmoji} listName={invite.listName} />
        <Icon icon={<ShieldAlert className="h-6 w-6" aria-hidden />} tone="muted" />
        <Title>Open this from Telegram</Title>
        <Subtitle>
          Tap the bot link in your Telegram chat to sign in, then open this
          invite again.
        </Subtitle>
      </Card>
    );
  }

  if (usernameMismatch) {
    return (
      <Card>
        <Headline emoji={invite.listEmoji} listName={invite.listName} />
        <Icon icon={<UserX className="h-6 w-6" aria-hidden />} tone="muted" />
        <Title>This invite is for someone else</Title>
        <Subtitle>
          {`This invite is for @${invitedUsername}. Sign in as them or ask ${invite.invitedByName} for a new invite.`}
        </Subtitle>
      </Card>
    );
  }

  // pending + can accept
  return (
    <Card>
      <Headline emoji={invite.listEmoji} listName={invite.listName} />
      <p
        style={{
          fontSize: "var(--lb-fs-md)",
          color: "var(--lb-muted-fg)",
          textAlign: "center",
          marginBottom: "var(--lb-sp-3)",
        }}
      >
        {invite.invitedByName} invited you
      </p>
      <div
        style={{
          display: "flex",
          gap: "var(--lb-sp-2)",
          justifyContent: "center",
          marginBottom: "var(--lb-sp-4)",
        }}
      >
        <Chip>{invite.role === "viewer" ? "Viewer" : "Editor"}</Chip>
        <Chip icon={<Calendar className="h-3 w-3" aria-hidden />}>
          {`Expires ${formatExpiryRelative(invite.expiresAt)}`}
        </Chip>
      </div>
      <Body>
        <Button
          type="button"
          onClick={accept}
          disabled={submitting}
          size="lg"
        >
          {submitting ? "Joining…" : "Accept invite"}
        </Button>
      </Body>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      role="region"
      aria-label="Invite"
      style={{
        maxWidth: 420,
        margin: "var(--lb-sp-12) auto 0",
        padding: "var(--lb-sp-6)",
        background: "var(--lb-card)",
        color: "var(--lb-card-fg)",
        borderRadius: "var(--lb-r-lg)",
        border: "1px solid var(--lb-border)",
        textAlign: "center",
      }}
    >
      {children}
    </section>
  );
}

function Headline({
  emoji,
  listName,
}: {
  emoji: string | null;
  listName: string;
}) {
  return (
    <h1
      style={{
        fontSize: "var(--lb-fs-2xl)",
        fontWeight: "var(--lb-fw-semibold)",
        letterSpacing: "var(--lb-tracking-title)",
        marginBottom: "var(--lb-sp-3)",
      }}
    >
      <span aria-hidden style={{ marginRight: "var(--lb-sp-2)" }}>
        {emoji ?? "📋"}
      </span>
      {listName}
    </h1>
  );
}

function Icon({
  icon,
  tone,
}: {
  icon: React.ReactNode;
  tone: "success" | "muted";
}) {
  const color = tone === "success" ? "var(--lb-success)" : "var(--lb-muted-fg)";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        marginBottom: "var(--lb-sp-3)",
        color,
      }}
    >
      {icon}
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: "var(--lb-fs-lg)",
        fontWeight: "var(--lb-fw-semibold)",
        color: "var(--lb-fg)",
        marginBottom: "var(--lb-sp-2)",
      }}
    >
      {children}
    </h2>
  );
}

function Subtitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: "var(--lb-fs-md)",
        color: "var(--lb-muted-fg)",
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: "var(--lb-sp-4)",
        display: "flex",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

function Chip({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[var(--lb-r-full)] px-2 py-1 text-xs font-medium"
      style={{
        background: "var(--lb-muted)",
        color: "var(--lb-muted-fg)",
      }}
    >
      {icon}
      {children}
    </span>
  );
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatExpiryRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ms = d.getTime() - Date.now();
  const days = Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
  if (days <= 0) return "soon";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

function acceptErrorCopy(code: string): string {
  switch (code) {
    case "invite_expired":
      return "This invite expired.";
    case "invite_username_mismatch":
      return "This invite is for a different Telegram account.";
    case "not_found":
      return "Invite not found.";
    case "unauthorized":
      return "Sign in via Telegram first.";
    default:
      return "Couldn't accept — try again.";
  }
}
