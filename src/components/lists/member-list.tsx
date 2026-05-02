"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MoreVertical, Trash2, Users } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  apiDelete,
  ApiError,
  apiFetch,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Member management — Phase 3 (read + remove).
 *
 * Renders inside the list-detail screen as a collapsible section under
 * the header. Owner-only kebab menu offers "Remove" (DELETE
 * /api/lists/[id]/members/[memberId]). Optimistic remove via TanStack
 * mutate's onMutate/onError pattern (matches `<ItemList />` Phase-2
 * pattern). Role change is owner-only Phase 4 surface — Phase 3
 * deliberately omits the control.
 *
 * The same query key (`["members", listId]`) is read by `<ItemList />`
 * to render assignee badges; mutating here invalidates both.
 */
export const membersKey = (listId: string) => ["members", listId] as const;

export type MemberRow = {
  id: string;
  listId: string;
  userId: string;
  role: "owner" | "editor" | "viewer";
  invitedBy: string | null;
  acceptedAt: string;
  createdAt: string;
  updatedAt: string;
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
    telegramPhotoUrl: string | null;
  };
};

type MembersResponse = { members: MemberRow[] };

/**
 * Fetch + cache members for a list. Other components (ItemList) consume
 * the same cache to render assignee badges.
 */
export function useMembers(
  listId: string,
  initialMembers?: MemberRow[],
) {
  return useQuery<MemberRow[]>({
    queryKey: membersKey(listId),
    queryFn: async () => {
      const data = await apiFetch<MembersResponse>(
        `/api/lists/${listId}/members`,
      );
      return data.members;
    },
    initialData: initialMembers,
  });
}

/**
 * Build a Map<userId, MemberRow> from the members query — used by
 * <ItemList /> to look up assignee names without an extra fetch.
 */
export function membersById(rows: MemberRow[] | undefined): Map<string, MemberRow> {
  const map = new Map<string, MemberRow>();
  for (const m of rows ?? []) map.set(m.userId, m);
  return map;
}

export function MemberList({
  listId,
  initialMembers,
  currentUserRole,
  defaultOpen = false,
}: {
  listId: string;
  initialMembers: MemberRow[];
  currentUserRole: "owner" | "editor" | "viewer";
  defaultOpen?: boolean;
}) {
  const queryClient = useQueryClient();
  const membersQuery = useMembers(listId, initialMembers);
  const members = membersQuery.data ?? [];
  const [open, setOpen] = React.useState(defaultOpen);
  const isOwner = currentUserRole === "owner";

  const removeMutation = useMutation<
    unknown,
    ApiError,
    { memberId: string },
    { previous?: MemberRow[] }
  >({
    mutationFn: async ({ memberId }) => {
      return apiDelete(`/api/lists/${listId}/members/${memberId}`);
    },
    onMutate: async ({ memberId }) => {
      await queryClient.cancelQueries({ queryKey: membersKey(listId) });
      const previous = queryClient.getQueryData<MemberRow[]>(membersKey(listId));
      queryClient.setQueryData<MemberRow[]>(
        membersKey(listId),
        (current) => (current ?? []).filter((m) => m.id !== memberId),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(membersKey(listId), ctx.previous);
      }
      toast.error(removeErrorCopy(err.code));
    },
    onSuccess: () => {
      toast.success("Member removed");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: membersKey(listId) });
      // also refresh items so assignee badges drop the now-removed user
      queryClient.invalidateQueries({ queryKey: ["items", listId] });
    },
  });

  const sectionId = `members-section-${listId}`;

  return (
    <section
      aria-labelledby={`${sectionId}-toggle`}
      style={{
        borderBottom: "1px solid var(--lg-border)",
      }}
    >
      <button
        type="button"
        id={`${sectionId}-toggle`}
        aria-expanded={open}
        aria-controls={sectionId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 px-4 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)] focus-visible:ring-inset",
        )}
        style={{ minHeight: 48, color: "var(--lg-fg)" }}
      >
        <Users
          className="h-4 w-4"
          aria-hidden
          style={{ color: "var(--lg-muted-fg)" }}
        />
        <span style={{ fontSize: "var(--lg-fs-md)", fontWeight: "var(--lg-fw-medium)" }}>
          Members
        </span>
        <span
          aria-hidden
          style={{
            fontSize: "var(--lg-fs-sm)",
            color: "var(--lg-muted-fg)",
          }}
        >
          {members.length}
        </span>
        <span style={{ flex: 1 }} aria-hidden />
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          aria-hidden
          style={{ color: "var(--lg-muted-fg)" }}
        />
      </button>

      {open && (
        <div id={sectionId} role="list" aria-label="List members">
          {members.length === 0 ? (
            <div
              role="listitem"
              className="px-4 py-3 text-sm"
              style={{ color: "var(--lg-muted-fg)" }}
            >
              No members yet.
            </div>
          ) : (
            members.map((member) => (
              <MemberRowView
                key={member.id}
                member={member}
                canRemove={isOwner && member.role !== "owner"}
                pending={
                  removeMutation.variables?.memberId === member.id &&
                  removeMutation.isPending
                }
                onRemove={() =>
                  removeMutation.mutate({ memberId: member.id })
                }
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function MemberRowView({
  member,
  canRemove,
  pending,
  onRemove,
}: {
  member: MemberRow;
  canRemove: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  const displayName =
    member.user.telegramUsername
      ? `@${member.user.telegramUsername}`
      : member.user.telegramFirstName;

  return (
    <div
      role="listitem"
      className={cn(
        "flex items-center gap-3 px-4 transition-opacity",
        pending && "opacity-60",
      )}
      style={{ minHeight: 56 }}
    >
      <Avatar
        name={member.user.telegramFirstName}
        photoUrl={member.user.telegramPhotoUrl}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          className="truncate"
          style={{
            fontSize: "var(--lg-fs-md)",
            fontWeight: "var(--lg-fw-medium)",
            color: "var(--lg-fg)",
          }}
        >
          {member.user.telegramFirstName}
        </p>
        <p
          className="truncate"
          style={{
            fontSize: "var(--lg-fs-sm)",
            color: "var(--lg-muted-fg)",
          }}
        >
          {displayName === member.user.telegramFirstName ? "" : displayName}
        </p>
      </div>
      <RoleChipReadonly role={member.role} />
      {canRemove ? (
        <MemberKebab
          memberLabel={displayName}
          pending={pending}
          onRemove={onRemove}
        />
      ) : (
        // keep tap-target-aligned spacing parity
        <span aria-hidden style={{ width: 44, height: 44 }} />
      )}
    </div>
  );
}

function RoleChipReadonly({
  role,
}: {
  role: "owner" | "editor" | "viewer";
}) {
  const label =
    role === "owner" ? "Owner" : role === "editor" ? "Editor" : "Viewer";
  return (
    <span
      className="inline-flex items-center rounded-[var(--lg-r-full)] px-2 py-1 text-xs font-medium"
      style={{
        background: "var(--lg-muted)",
        color: "var(--lg-muted-fg)",
      }}
    >
      {label}
    </span>
  );
}

function MemberKebab({
  memberLabel,
  pending,
  onRemove,
}: {
  memberLabel: string;
  pending: boolean;
  onRemove: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Actions for ${memberLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical
          className="h-4 w-4"
          style={{ color: "var(--lg-muted-fg)" }}
          aria-hidden
        />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${memberLabel}`}
          className="absolute right-0 top-full z-20 mt-1 min-w-[180px] overflow-hidden rounded-[var(--lg-r-md)] border"
          style={{
            background: "var(--lg-card)",
            borderColor: "var(--lg-border)",
            boxShadow: "var(--lg-shadow-popover)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--lg-muted)] focus-visible:bg-[var(--lg-muted)] focus-visible:outline-none"
            style={{ color: "var(--lg-destructive)" }}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Remove
          </button>
          <button
            type="button"
            role="menuitem"
            disabled
            aria-disabled="true"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm opacity-50"
            style={{ color: "var(--lg-muted-fg)" }}
            title="Coming in Phase 4"
          >
            Change role
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Avatar pill — 28×28 monogram fallback. Used by both <MemberList /> and
 * the assignee badge in <ItemRow />.
 */
export function Avatar({
  name,
  photoUrl,
  size = 28,
}: {
  name: string | null | undefined;
  photoUrl: string | null | undefined;
  size?: number;
}) {
  const monogram = monogramOf(name);
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium"
      style={{
        width: size,
        height: size,
        background: "var(--lg-muted)",
        color: "var(--lg-muted-fg)",
        fontSize: Math.max(11, Math.round(size * 0.42)),
      }}
    >
      {monogram}
    </span>
  );
}

export function monogramOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) return "?";
  // Use the first code point so "👤Ali" doesn't break — but in practice
  // first names have a leading letter; a simple charAt is fine.
  return trimmed.charAt(0).toUpperCase();
}

function removeErrorCopy(code: string): string {
  switch (code) {
    case "forbidden":
      return "Only the owner can remove members.";
    case "cannot_remove_owner":
      return "The owner can't be removed.";
    case "not_found":
      return "Member not found.";
    default:
      return "Couldn't remove — try again.";
  }
}
