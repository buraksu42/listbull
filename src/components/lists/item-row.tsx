import type { Item } from "@/lib/types";

/**
 * Phase 1: read-only item row. Phase 2 will add toggle, edit, delete, and drag.
 * Circular checkbox, 22×22, accent fill on done.
 */
export function ItemRow({ item }: { item: Item }) {
  return (
    <div
      role="listitem"
      aria-label={`${item.isDone ? "completed " : ""}${item.text}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--lg-sp-3)",
        padding: "var(--lg-sp-4)",
        minHeight: 56,
        borderBottom: "1px solid var(--lg-border)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: "var(--lg-checkbox)",
          height: "var(--lg-checkbox)",
          borderRadius: "var(--lg-r-full)",
          border: `2px solid ${item.isDone ? "var(--lg-accent)" : "var(--lg-muted-fg)"}`,
          background: item.isDone ? "var(--lg-accent)" : "transparent",
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
        }}
      >
        {item.isDone && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 6.5l2.5 2.5L10 3.5"
              stroke="var(--lg-accent-fg)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span
        style={{
          fontSize: "var(--lg-fs-lg)",
          color: item.isDone ? "var(--lg-muted-fg)" : "var(--lg-fg)",
          textDecoration: item.isDone ? "line-through" : "none",
          opacity: item.isDone ? 0.7 : 1,
          flex: 1,
        }}
      >
        {item.text}
      </span>
    </div>
  );
}
