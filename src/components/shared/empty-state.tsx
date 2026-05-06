import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  cta,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  cta?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "var(--lb-sp-12) var(--lb-sp-6)",
        textAlign: "center",
        color: "var(--lb-muted-fg)",
      }}
    >
      {icon && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "var(--lb-sp-3)",
            color: "var(--lb-muted-fg)",
          }}
        >
          {icon}
        </div>
      )}
      <h2
        style={{
          fontSize: "var(--lb-fs-xl)",
          fontWeight: "var(--lb-fw-semibold)",
          color: "var(--lb-fg)",
          letterSpacing: "var(--lb-tracking-title)",
          marginBottom: "var(--lb-sp-2)",
        }}
      >
        {title}
      </h2>
      {description && (
        <p
          style={{
            fontSize: "var(--lb-fs-md)",
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
      {cta && <div style={{ marginTop: "var(--lb-sp-4)" }}>{cta}</div>}
    </div>
  );
}
