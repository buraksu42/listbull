/**
 * ReminderIndicator — small calendar glyph next to items with an
 * active future deadline. Phase 14d: renders based on `deadlineAt`
 * only; reminders themselves are surfaced separately when needed.
 * Returns null for items without a deadline or with a past deadline.
 *
 * Changed from AlarmClock → Calendar 2026-05-08 per user feedback —
 * the calendar metaphor reads as "scheduled for a date" rather than
 * "an alarm will go off."
 */
import { Calendar } from "lucide-react";

type Props = {
  deadlineAt: Date | string | null;
};

export function ReminderIndicator({ deadlineAt }: Props) {
  if (!deadlineAt) return null;
  const d = typeof deadlineAt === "string" ? new Date(deadlineAt) : deadlineAt;
  if (Number.isNaN(d.getTime())) return null;
  // eslint-disable-next-line react-hooks/purity -- 1-frame staleness is fine for this read-only glyph; React re-renders on parent updates anyway.
  if (d.getTime() <= Date.now()) return null;

  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);

  return (
    <span
      aria-label={`deadline: ${formatted}`}
      title={formatted}
      style={{
        display: "inline-flex",
        color: "var(--lb-accent)",
        flexShrink: 0,
      }}
    >
      <Calendar size={14} aria-hidden="true" />
    </span>
  );
}
