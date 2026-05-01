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
        gap: "var(--lg-sp-3)",
        padding: "var(--lg-sp-4)",
        minHeight: 56,
        borderBottom: "1px solid var(--lg-border)",
        color: "var(--lg-fg)",
        textDecoration: "none",
      }}
    >
      <span style={{ fontSize: "var(--lg-fs-2xl)" }} aria-hidden>
        {emoji}
      </span>
      <span
        style={{
          fontSize: "var(--lg-fs-lg)",
          fontWeight: "var(--lg-fw-medium)",
          letterSpacing: "var(--lg-tracking-title)",
        }}
      >
        {list.isInbox ? "Inbox" : list.name}
      </span>
    </Link>
  );
}
