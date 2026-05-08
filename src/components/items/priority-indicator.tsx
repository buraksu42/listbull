/**
 * PriorityIndicator — to the left of the item row.
 *   low    → no glyph (most items, keep noise low).
 *   normal → outlined dot (subtle).
 *   high   → Pin icon (📌 metaphor; "pinned/sabit" per user feedback
 *            2026-05-08).
 * Per design.md: "no third color introduced" — high-priority shares
 * the accent palette so the affordance reads "active brand color,
 * urgent."
 */
import { Pin } from "lucide-react";

type Props = {
  priority: "low" | "normal" | "high";
};

export function PriorityIndicator({ priority }: Props) {
  if (priority === "low") return null;

  if (priority === "high") {
    return (
      <span
        aria-label="priority: high (pinned)"
        title="Sabitlendi"
        style={{
          display: "inline-flex",
          color: "var(--lb-accent)",
          flexShrink: 0,
        }}
      >
        <Pin size={14} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      aria-label="priority: normal"
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "transparent",
        border: `1.5px solid var(--lb-accent)`,
        flexShrink: 0,
      }}
    />
  );
}
