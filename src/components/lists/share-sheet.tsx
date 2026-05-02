"use client";

import { Check, Copy, Send } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/sonner";
import { useTelegramMainButton } from "@/hooks/use-telegram-main-button";
import { ApiError, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Share sheet — Phase 3.
 *
 * Two states inside one sheet:
 *   1. "form"    — username + role select + Save (via Telegram MainButton).
 *   2. "success" — generated deeplink + copy + share-via-Telegram link.
 *
 * Trigger sources (any of):
 *   - the parent list-header button (controlled `open`/`onOpenChange`).
 *   - `?share=1` query string on `/lists/[id]` (deeplink). The hook
 *     reads `useSearchParams` and forces open on first render; the
 *     `onOpenChange(false)` handler scrubs the query so the sheet
 *     doesn't re-open on later renders.
 *
 * Owner-only: the parent omits this whole component entirely for
 * non-owners and for Inbox lists. The component itself doesn't re-check.
 */
type ShareSuccess = {
  deeplink: string;
  invitedUsername: string;
  alreadyMember: boolean;
};

type ShareSheetProps = {
  listId: string;
  listName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ShareInviteResponse = {
  invite: {
    token: string;
    expiresAt: string;
    deeplink: string;
    role: "editor" | "viewer";
  };
  list: { id: string; name: string; emoji: string | null };
  invitedUsername: string;
  alreadyMember?: boolean;
  warnings?: string[];
};

export function ShareSheet({
  listId,
  listName,
  open,
  onOpenChange,
}: ShareSheetProps) {
  const [username, setUsername] = React.useState("");
  const [role, setRole] = React.useState<"editor" | "viewer">("editor");
  const [submitting, setSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState<ShareSuccess | null>(null);

  // Reset state every time the sheet closes so a re-open lands clean.
  React.useEffect(() => {
    if (!open) {
      // small defer so the close animation doesn't show an empty form
      const t = window.setTimeout(() => {
        setUsername("");
        setRole("editor");
        setSubmitting(false);
        setSuccess(null);
      }, 200);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const submit = React.useCallback(async () => {
    const cleaned = username.trim().replace(/^@/, "");
    if (!cleaned) {
      toast.error("Enter a Telegram username.");
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiPost<ShareInviteResponse>(
        `/api/lists/${listId}/invite`,
        { username: cleaned, role },
      );
      if (data.alreadyMember) {
        setSuccess({
          deeplink: "",
          invitedUsername: data.invitedUsername,
          alreadyMember: true,
        });
        return;
      }
      setSuccess({
        deeplink: data.invite.deeplink,
        invitedUsername: data.invitedUsername,
        alreadyMember: false,
      });
      if (data.warnings?.includes("invitee_dm_failed")) {
        toast.message(
          "Invite created — DM didn't send. Share the link manually below.",
        );
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "unknown";
      const message = errorCopy(code);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [listId, role, username]);

  const submitFromMainButton = React.useCallback(() => {
    void submit();
  }, [submit]);

  // Telegram MainButton drives the form submit; only visible when on
  // the form step AND the username has at least 1 char.
  useTelegramMainButton({
    visible: open && success === null && username.trim().length > 0,
    text: "Send invite",
    onClick: submitFromMainButton,
    disabled: submitting,
    loading: submitting,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent ariaLabel="Share list">
        <SheetHeader>
          <SheetTitle>
            {success ? "Invite ready" : `Share ${listName}`}
          </SheetTitle>
          <SheetDescription>
            {success
              ? success.alreadyMember
                ? `@${success.invitedUsername} is already a member.`
                : "They'll get a one-tap accept link in chat."
              : "Type a Telegram username — they'll get a one-tap accept link."}
          </SheetDescription>
        </SheetHeader>

        {success ? (
          <ShareSuccessBody
            success={success}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <ShareFormBody
            username={username}
            role={role}
            submitting={submitting}
            onUsernameChange={setUsername}
            onRoleChange={setRole}
            onSubmit={submit}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Hook: read `?share=1` once on first mount and pop the sheet. Owners
 * call this from the list page to wire deeplink-driven open state.
 */
export function useShareDeeplink({
  enabled,
  setOpen,
}: {
  enabled: boolean;
  setOpen: (open: boolean) => void;
}): void {
  const search = useSearchParams();
  const router = useRouter();
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || fired.current) return;
    if (search.get("share") === "1") {
      fired.current = true;
      setOpen(true);
      // scrub the query so refresh doesn't re-open
      const params = new URLSearchParams(search.toString());
      params.delete("share");
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : window.location.pathname, {
        scroll: false,
      });
    }
  }, [enabled, search, router, setOpen]);
}

function ShareFormBody({
  username,
  role,
  submitting,
  onUsernameChange,
  onRoleChange,
  onSubmit,
  onCancel,
}: {
  username: string;
  role: "editor" | "viewer";
  submitting: boolean;
  onUsernameChange: (v: string) => void;
  onRoleChange: (v: "editor" | "viewer") => void;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <SheetBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="share-username">Telegram username</Label>
          <Input
            id="share-username"
            autoFocus
            placeholder="@ali"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={username}
            onChange={(e) => onUsernameChange(stripLeadingAt(e.target.value))}
            aria-describedby="share-username-hint"
          />
          <p
            id="share-username-hint"
            className="text-xs"
            style={{ color: "var(--lg-muted-fg)" }}
          >
            Without the @, lower-case. They must have started the bot once.
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend
            className="text-sm font-medium"
            style={{ color: "var(--lg-fg)" }}
          >
            Role
          </legend>
          <div className="flex gap-2">
            {(["editor", "viewer"] as const).map((r) => (
              <RoleChip
                key={r}
                value={r}
                checked={role === r}
                onSelect={() => onRoleChange(r)}
              />
            ))}
          </div>
        </fieldset>
      </SheetBody>

      <SheetFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting || username.trim().length === 0}
        >
          {submitting ? "Sending…" : "Send invite"}
        </Button>
      </SheetFooter>
    </form>
  );
}

function ShareSuccessBody({
  success,
  onDone,
}: {
  success: ShareSuccess;
  onDone: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  if (success.alreadyMember) {
    return (
      <>
        <SheetBody className="flex flex-col gap-3">
          <div
            className="flex items-center gap-2 rounded-[var(--lg-r-md)] p-3"
            style={{ background: "var(--lg-muted)" }}
          >
            <Check
              className="h-4 w-4"
              style={{ color: "var(--lg-success)" }}
              aria-hidden
            />
            <span style={{ color: "var(--lg-fg)" }}>
              @{success.invitedUsername} is already on this list.
            </span>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </SheetFooter>
      </>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(success.deeplink);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — long-press to copy manually.");
    }
  };

  const tgShare = `https://t.me/share/url?url=${encodeURIComponent(success.deeplink)}&text=${encodeURIComponent(
    `Join my list on listgram`,
  )}`;

  return (
    <>
      <SheetBody className="flex flex-col gap-3">
        <div
          className="flex flex-col gap-2 rounded-[var(--lg-r-md)] p-3"
          style={{ background: "var(--lg-muted)" }}
        >
          <p
            className="text-xs"
            style={{ color: "var(--lg-muted-fg)" }}
          >
            Invite link for @{success.invitedUsername}
          </p>
          <code
            className="block break-all text-sm"
            style={{ color: "var(--lg-fg)" }}
          >
            {success.deeplink}
          </code>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <a
            href={tgShare}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[var(--lg-r-md)] px-4 text-base font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--lg-bg)]",
            )}
            style={{
              background: "var(--lg-accent)",
              color: "var(--lg-accent-fg)",
            }}
          >
            <Send className="h-4 w-4" aria-hidden />
            Share via Telegram
          </a>
        </div>
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </SheetFooter>
    </>
  );
}

function RoleChip({
  value,
  checked,
  onSelect,
}: {
  value: "editor" | "viewer";
  checked: boolean;
  onSelect: () => void;
}) {
  const labelMap = { editor: "Editor", viewer: "Viewer" } as const;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex-1 rounded-[var(--lg-r-md)] border px-3 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--lg-bg)]",
        checked
          ? "border-transparent"
          : "border-[var(--lg-border)] bg-transparent",
      )}
      style={{
        background: checked ? "var(--lg-accent)" : "var(--lg-input-bg)",
        color: checked ? "var(--lg-accent-fg)" : "var(--lg-fg)",
        minHeight: 44,
      }}
    >
      {labelMap[value]}
    </button>
  );
}

function stripLeadingAt(value: string): string {
  return value.replace(/^@+/, "").toLowerCase();
}

function errorCopy(code: string): string {
  switch (code) {
    case "already_member":
      return "That user is already on this list.";
    case "cannot_share_inbox":
      return "Inbox lists can't be shared.";
    case "forbidden":
      return "Only the list owner can share.";
    case "not_found":
      return "List not found.";
    case "invalid_input":
      return "Check the username and try again.";
    case "unauthorized":
      return "Sign in via Telegram first.";
    default:
      return "Couldn't send invite — try again.";
  }
}
