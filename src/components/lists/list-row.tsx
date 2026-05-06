import Link from "next/link";

import type { ListWithCounts } from "@/lib/db/queries/lists";

export function ListRow({ list }: { list: ListWithCounts }) {
  const emoji = list.emoji ?? (list.isInbox ? "📥" : "📋");
  const total = list.openCount + list.doneCount;

  return (
    <Link
      href={`/lists/${list.id}`}
      aria-label={`${list.isInbox ? "Inbox" : list.name} — ${list.openCount} open, ${list.doneCount} done`}
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
          fontSize: "var(--lb-fs-lg)",
          fontWeight: "var(--lb-fw-medium)",
          letterSpacing: "var(--lb-tracking-title)",
        }}
      >
        {list.isInbox ? "Inbox" : list.name}
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
