/**
 * TagChip — inline rounded-rect for an item tag. Workspace-scoped
 * vocabulary; the first 6 unique tags get accent palette variants,
 * the 7th+ falls back to muted. We pick the palette by hashing the
 * tag name so the same tag always renders the same color across
 * sessions.
 */
type Props = {
  tag: string;
};

const HUE_PALETTE = [
  { bg: "color-mix(in srgb, var(--lb-accent) 14%, transparent)", fg: "var(--lb-accent)" },
  { bg: "color-mix(in srgb, var(--lb-success, #2EB872) 14%, transparent)", fg: "var(--lb-success, #2EB872)" },
  { bg: "color-mix(in srgb, var(--lb-warning, #F0A020) 14%, transparent)", fg: "var(--lb-warning, #F0A020)" },
  { bg: "color-mix(in srgb, var(--lb-destructive, #D72D40) 14%, transparent)", fg: "var(--lb-destructive, #D72D40)" },
  { bg: "var(--lb-muted)", fg: "var(--lb-muted-fg)" },
  { bg: "var(--lb-muted)", fg: "var(--lb-fg)" },
];

function pickPalette(tag: string): (typeof HUE_PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % HUE_PALETTE.length;
  return HUE_PALETTE[idx]!;
}

export function TagChip({ tag }: Props) {
  const { bg, fg } = pickPalette(tag);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: bg,
        color: fg,
        padding: "1px 8px",
        borderRadius: "var(--lb-radius-sm, 4px)",
        fontSize: "11px",
        fontWeight: "var(--lb-fw-medium)",
      }}
    >
      #{tag}
    </span>
  );
}
