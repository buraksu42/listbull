/**
 * PriorityIndicator — to the left of the item row.
 *   high   → Flame 🔥 (urgent — user-picked default 2026-05-08)
 *   normal → no glyph (default state, keep noise low)
 *   low    → Snowflake ❄ (back-burner)
 *
 * Pin (sabitleme) is now a SEPARATE feature wired through
 * PinButton on the row + items.pinned_at column. Don't confuse the
 * two glyphs.
 */
import { Flame, Snowflake } from "lucide-react";

type Props = {
  priority: "low" | "normal" | "high";
};

export function PriorityIndicator({ priority }: Props) {
  if (priority === "normal") return null;

  if (priority === "high") {
    return (
      <span
        aria-label="priority: high"
        title="Yüksek öncelik"
        style={{
          display: "inline-flex",
          color: "var(--lb-destructive)",
          flexShrink: 0,
        }}
      >
        <Flame size={14} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      aria-label="priority: low"
      title="Düşük öncelik"
      style={{
        display: "inline-flex",
        color: "var(--lb-muted-fg)",
        flexShrink: 0,
      }}
    >
      <Snowflake size={14} aria-hidden="true" />
    </span>
  );
}
