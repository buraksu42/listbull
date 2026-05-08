/**
 * StatusBadge — inline pill on item rows. Phase 4.5 item discipline.
 * Uses semantic palette (no new brand colors per design.md) so light
 * + dark themes both render correctly. `open` is intentionally
 * invisible — most items are open and rendering a badge for the
 * default state would clutter the row.
 */
type Props = {
  status: "open" | "in_progress" | "blocked" | "done";
};

// Labels aligned with the new chip vocabulary (Yapılacak/Yapılıyor/
// Bekliyor/Tamamlandı, 2026-05-08). Open is intentionally invisible
// — most items are in this state and rendering a badge for the
// default would clutter the row.
const PALETTE: Record<
  Props["status"],
  { label: string; bg: string; fg: string } | null
> = {
  open: null,
  in_progress: {
    label: "Yapılıyor",
    bg: "color-mix(in srgb, var(--lb-accent) 15%, transparent)",
    fg: "var(--lb-accent)",
  },
  blocked: {
    label: "Bekliyor",
    bg: "color-mix(in srgb, var(--lb-warning, #F0A020) 18%, transparent)",
    fg: "var(--lb-warning, #F0A020)",
  },
  done: {
    label: "Tamamlandı",
    bg: "color-mix(in srgb, var(--lb-success, #2EB872) 15%, transparent)",
    fg: "var(--lb-success, #2EB872)",
  },
};

export function StatusBadge({ status }: Props) {
  const conf = PALETTE[status];
  if (!conf) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: conf.bg,
        color: conf.fg,
        padding: "1px 6px",
        borderRadius: "999px",
        fontSize: "10px",
        fontWeight: "var(--lb-fw-medium)",
        letterSpacing: "0.02em",
        textTransform: "uppercase",
      }}
      aria-label={`status: ${conf.label}`}
    >
      {conf.label}
    </span>
  );
}
