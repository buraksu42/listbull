"use client";

import { History, Home, Share2 } from "lucide-react";
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
          height: "var(--lb-header-h)",
          padding: "0 var(--lb-sp-4)",
          display: "flex",
          alignItems: "center",
          gap: "var(--lb-sp-3)",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <span style={{ fontSize: "var(--lb-fs-xl)" }} aria-hidden>
          {emoji}
        </span>
        <h1
          style={{
            fontSize: "var(--lb-fs-xl)",
            fontWeight: "var(--lb-fw-semibold)",
            letterSpacing: "var(--lb-tracking-title)",
            flex: 1,
            minWidth: 0,
          }}
          className="truncate"
        >
          {listName}
        </h1>

        <div className="flex items-center gap-1">
          <Link
            href="/lists"
            aria-label="Tüm listeler"
            title="Tüm listeler"
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-[var(--lb-r-md)]",
              "hover:bg-[var(--lb-muted)] focus-visible:bg-[var(--lb-muted)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
            )}
          >
            <Home
              className="h-5 w-5"
              aria-hidden
              style={{ color: "var(--lb-muted-fg)" }}
            />
          </Link>

          <Link
            href={`/lists/${listId}/activity`}
            aria-label={`Activity for ${listName}`}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-[var(--lb-r-md)]",
              "hover:bg-[var(--lb-muted)] focus-visible:bg-[var(--lb-muted)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
            )}
          >
            <History
              className="h-5 w-5"
              aria-hidden
              style={{ color: "var(--lb-muted-fg)" }}
            />
          </Link>

          {canShare && (
            <button
              type="button"
              aria-label={`Share ${listName}`}
              onClick={() => setShareOpen(true)}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-[var(--lb-r-md)]",
                "hover:bg-[var(--lb-muted)] focus-visible:bg-[var(--lb-muted)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
              )}
            >
              <Share2
                className="h-5 w-5"
                aria-hidden
                style={{ color: "var(--lb-muted-fg)" }}
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
