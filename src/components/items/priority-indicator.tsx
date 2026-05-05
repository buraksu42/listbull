/**
 * PriorityIndicator — small dot to the left of the item row.
 *   low    → no dot (most items)
 *   normal → outlined dot (subtle)
 *   high   → filled accent dot
 * Per design.md: "no third color introduced" — high-priority shares
 * the accent palette so the badge reads "active brand color, urgent."
 */
type Props = {
  priority: "low" | "normal" | "high";
};

export function PriorityIndicator({ priority }: Props) {
  if (priority === "low") return null;
  const filled = priority === "high";
  return (
    <span
      aria-label={`priority: ${priority}`}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: filled ? "var(--lb-accent)" : "transparent",
        border: `1.5px solid var(--lb-accent)`,
        flexShrink: 0,
      }}
    />
  );
}
