/**
 * ReminderIndicator — small calendar glyph next to items with an
 * active future reminder. Renders nothing for items without due_at,
 * past due_at (already fired), or already-sent reminders.
 *
 * Changed from AlarmClock → Calendar 2026-05-08 per user feedback —
 * the calendar metaphor reads as "scheduled for a date" rather than
 * "an alarm will go off."
 */
import { Calendar } from "lucide-react";

type Props = {
  dueAt: Date | string | null;
  reminderSent: boolean;
};

export function ReminderIndicator({ dueAt, reminderSent }: Props) {
  if (!dueAt || reminderSent) return null;
  const d = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= Date.now()) return null;

  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);

  return (
    <span
      aria-label={`reminder: ${formatted}`}
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
