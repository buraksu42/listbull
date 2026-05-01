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
        padding: "var(--lg-sp-12) var(--lg-sp-6)",
        textAlign: "center",
        color: "var(--lg-muted-fg)",
      }}
    >
      {icon && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "var(--lg-sp-3)",
            color: "var(--lg-muted-fg)",
          }}
        >
          {icon}
        </div>
      )}
      <h2
        style={{
          fontSize: "var(--lg-fs-xl)",
          fontWeight: "var(--lg-fw-semibold)",
          color: "var(--lg-fg)",
          letterSpacing: "var(--lg-tracking-title)",
          marginBottom: "var(--lg-sp-2)",
        }}
      >
        {title}
      </h2>
      {description && (
        <p
          style={{
            fontSize: "var(--lg-fs-md)",
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
      {cta && <div style={{ marginTop: "var(--lg-sp-4)" }}>{cta}</div>}
    </div>
  );
}
