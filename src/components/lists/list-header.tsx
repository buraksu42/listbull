"use client";

import { History, Share2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ShareSheet, useShareDeeplink } from "@/components/lists/share-sheet";
import { cn } from "@/lib/utils";

/**
 * List detail header — Phase 3.
 *
 * Lives between server-side data load (page.tsx) and the interactive
 * client surfaces (ShareSheet). Holds the share-sheet's open state so
 * both the trailing "Share" icon AND the `?share=1` deeplink can pop it.
 *
 * Owner-only logic: the Share icon and the ShareSheet are hidden
 * entirely for non-owners and for Inbox lists.
 */
export function ListHeader({
  listId,
  listName,
  emoji,
  isInbox,
  currentUserRole,
}: {
  listId: string;
  listName: string;
  emoji: string;
  isInbox: boolean;
  currentUserRole: "owner" | "editor" | "viewer";
}) {
  const canShare = currentUserRole === "owner" && !isInbox;
  const [shareOpen, setShareOpen] = React.useState(false);

  // Hook reads `?share=1` once and pops the sheet (only when canShare).
  useShareDeeplink({ enabled: canShare, setOpen: setShareOpen });

  return (
    <>
      <header
        style={{
          height: "var(--lg-header-h)",
          padding: "0 var(--lg-sp-4)",
          display: "flex",
          alignItems: "center",
          gap: "var(--lg-sp-3)",
          borderBottom: "1px solid var(--lg-border)",
        }}
      >
        <span style={{ fontSize: "var(--lg-fs-xl)" }} aria-hidden>
          {emoji}
        </span>
        <h1
          style={{
            fontSize: "var(--lg-fs-xl)",
            fontWeight: "var(--lg-fw-semibold)",
            letterSpacing: "var(--lg-tracking-title)",
            flex: 1,
            minWidth: 0,
          }}
          className="truncate"
        >
          {listName}
        </h1>

        <div className="flex items-center gap-1">
          <Link
            href={`/lists/${listId}/activity`}
            aria-label={`Activity for ${listName}`}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-[var(--lg-r-md)]",
              "hover:bg-[var(--lg-muted)] focus-visible:bg-[var(--lg-muted)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)]",
            )}
          >
            <History
              className="h-5 w-5"
              aria-hidden
              style={{ color: "var(--lg-muted-fg)" }}
            />
          </Link>

          {canShare && (
            <button
              type="button"
              aria-label={`Share ${listName}`}
              onClick={() => setShareOpen(true)}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-[var(--lg-r-md)]",
                "hover:bg-[var(--lg-muted)] focus-visible:bg-[var(--lg-muted)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)]",
              )}
            >
              <Share2
                className="h-5 w-5"
                aria-hidden
                style={{ color: "var(--lg-muted-fg)" }}
              />
            </button>
          )}
        </div>
      </header>

      {canShare && (
        <ShareSheet
          listId={listId}
          listName={listName}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </>
  );
}
