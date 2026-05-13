import Link from "next/link";

import type { ListWithCounts } from "@/lib/db/queries/lists";

export function ListRow({ list }: { list: ListWithCounts }) {
  const emoji = list.emoji ?? (list.isInbox ? "📥" : "📋");
  const total = list.openCount + list.doneCount;
  const isPublic = list.visibility === "public";

  return (
    <Link
      href={`/lists/${list.id}`}
      aria-label={`${list.isInbox ? "Inbox" : list.name} — ${list.openCount} open, ${list.doneCount} done${isPublic ? ", public" : ""}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--lb-sp-3)",
        padding: "var(--lb-sp-4)",
        minHeight: 56,
        borderBottom: "1px solid var(--lb-border)",
        color: "var(--lb-fg)",
        textDecoration: "none",
      }}
    >
      <span style={{ fontSize: "var(--lb-fs-2xl)" }} aria-hidden>
        {emoji}
      </span>
      <span
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: "var(--lb-sp-2)",
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: "var(--lb-fs-lg)",
            fontWeight: "var(--lb-fw-medium)",
            letterSpacing: "var(--lb-tracking-title)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {list.isInbox ? "Inbox" : list.name}
        </span>
        {!list.isInbox && <VisibilityBadge isPublic={isPublic} />}
      </span>
      <span
        aria-hidden
        style={{
          fontSize: "var(--lb-fs-sm)",
          color: "var(--lb-muted-fg)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {total === 0
          ? "—"
          : list.doneCount === 0
            ? `${list.openCount}`
            : `${list.openCount}/${total}`}
      </span>
    </Link>
  );
}

function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  return (
    <span
      aria-label={isPublic ? "public list" : "private list"}
      title={
        isPublic
          ? "Public — workspace üyeleri görür"
          : "Private — sadece list üyeleri görür"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: "var(--lb-fs-xs)",
        color: "var(--lb-muted-fg)",
        background: isPublic
          ? "color-mix(in srgb, var(--lb-accent) 12%, transparent)"
          : "transparent",
        border: isPublic
          ? "1px solid color-mix(in srgb, var(--lb-accent) 35%, transparent)"
          : "1px solid var(--lb-border)",
        borderRadius: 6,
        padding: "1px 6px",
        flexShrink: 0,
      }}
    >
      {isPublic ? "🌐" : "🔒"}
    </span>
  );
}
