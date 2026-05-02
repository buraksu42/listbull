import Link from "next/link";

import type { List } from "@/lib/types";

export function ListRow({ list }: { list: List }) {
  const emoji = list.emoji ?? (list.isInbox ? "📥" : "📋");

  return (
    <Link
      href={`/lists/${list.id}`}
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
          fontSize: "var(--lb-fs-lg)",
          fontWeight: "var(--lb-fw-medium)",
          letterSpacing: "var(--lb-tracking-title)",
        }}
      >
        {list.isInbox ? "Inbox" : list.name}
      </span>
    </Link>
  );
}
