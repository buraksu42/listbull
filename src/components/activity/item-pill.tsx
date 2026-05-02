/**
 * Inline pill rendering an item title inside an activity sentence
 * (e.g. "completed «süt al»"). Truncates around 30 chars with ellipsis.
 */
export function ItemPill({ text }: { text: string | null | undefined }) {
  const safe = (text ?? "").trim();
  const display = safe.length > 30 ? `${safe.slice(0, 29)}…` : safe;
  return (
    <span
      className="inline-flex max-w-full items-center rounded-[var(--lb-r-sm)] px-1.5 py-0.5 align-baseline"
      style={{
        background: "var(--lb-muted)",
        color: "var(--lb-fg)",
        fontSize: "var(--lb-fs-sm)",
        fontWeight: "var(--lb-fw-medium)",
      }}
      title={safe}
    >
      {display || "—"}
    </span>
  );
}
