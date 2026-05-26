/**
 * RFC 5545 RRULE evaluation — single source for recurrence arithmetic.
 *
 * Used by:
 *  - `complete-item` to advance `items.deadline_at` when a recurring
 *    todo is marked done.
 *  - `dispatch-reminders` to re-arm `item_reminders.remind_at` for
 *    reminders that carry their own `recurrence_rule`.
 *
 * Centralising here means a typo or arithmetic bug shows up in tests
 * once instead of leaking divergent behaviour across both call sites.
 *
 * Timezone note: the `rrule` package treats dtstart as a naive Date.
 * Our `deadline_at` / `remind_at` columns are `timestamptz` and arrive
 * as JS Date (UTC moment). For pure FREQ=DAILY/WEEKLY/MONTHLY/YEARLY
 * cases the UTC delta matches the wall-clock delta, so a 22:00
 * Europe/Istanbul deadline stays 22:00 Europe/Istanbul next day. DST
 * transitions can shift by 1h around the Mar/Oct boundary for tzs that
 * observe DST; acceptable for v1, document if it bites.
 */
import "server-only";

import { rrulestr } from "rrule";

/**
 * Next occurrence strictly after `from` according to `rruleStr`.
 * Returns `null` if the rule is malformed or has no further occurrence
 * (e.g. an UNTIL= clause that's already past). Callers must handle
 * null — silently keeping the original deadline would mask a bad rule.
 */
export function nextOccurrence(rruleStr: string, from: Date): Date | null {
  try {
    // dtstart anchors the recurrence sequence. Using `from` keeps the
    // sequence aligned to the current deadline rather than to whenever
    // the user originally created the rule — important when a user
    // pauses a recurring task for weeks and then completes it.
    const rule = rrulestr(rruleStr, { dtstart: from });
    const next = rule.after(from, /* inclusive */ false);
    return next ?? null;
  } catch {
    return null;
  }
}

/** Preset RRULE strings the bot picker emits. Keep in lockstep with
 *  the UI labels — picker → callback → applyPresetRule → DB. */
export const RECURRENCE_PRESETS = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
} as const;

export type RecurrencePreset = keyof typeof RECURRENCE_PRESETS;

/**
 * Best-effort short label for an RRULE string. The picker writes one
 * of the four presets, but the LLM may set custom rules (e.g.
 * `FREQ=WEEKLY;BYDAY=MO,WE,FR`). For anything outside the preset set
 * we fall back to a generic "Özel" / "Custom" so the button stays
 * scannable instead of leaking the raw RRULE.
 */
export function recurrenceLabel(
  rruleStr: string | null,
  locale: "tr" | "en",
): string {
  if (!rruleStr) return locale === "tr" ? "Tekrar yok" : "No repeat";
  const tr = locale === "tr";
  const normalized = rruleStr.replace(/\s+/g, "").toUpperCase();
  if (normalized === "FREQ=DAILY") return tr ? "Günlük" : "Daily";
  if (normalized === "FREQ=WEEKLY") return tr ? "Haftalık" : "Weekly";
  if (normalized === "FREQ=MONTHLY") return tr ? "Aylık" : "Monthly";
  if (normalized === "FREQ=YEARLY") return tr ? "Yıllık" : "Yearly";
  return tr ? "Özel" : "Custom";
}
