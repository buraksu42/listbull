/**
 * Locale-aware relative time formatter.
 *
 * Buckets (per spec):
 *   - <60s        → "now" / "şimdi"
 *   - <60min      → "Nm ago" / "N dk önce" (Intl.RelativeTimeFormat unit "minute")
 *   - <24h        → "Nh ago" / "N sa önce"
 *   - else        → "Nd ago" / "N gün önce"
 *
 * `Intl.RelativeTimeFormat` handles plural and locale rules. We pick a
 * single unit per call (no "1 day, 3 hours ago" composition — keep
 * activity-feed timestamps glanceable).
 */
export type SupportedLocale = "tr" | "en";

const MS_MIN = 60 * 1000;
const MS_HOUR = 60 * MS_MIN;
const MS_DAY = 24 * MS_HOUR;

export function formatRelativeTime(
  date: Date | string,
  locale: SupportedLocale,
  now: Date = new Date(),
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const diffMs = now.getTime() - d.getTime();
  const absMs = Math.abs(diffMs);

  if (absMs < MS_MIN) {
    return locale === "tr" ? "şimdi" : "now";
  }

  // Intl signs the value: negative for past, positive for future. We
  // pass negative for past timestamps (most common in the activity feed).
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const sign = diffMs >= 0 ? -1 : 1;

  if (absMs < MS_HOUR) {
    const minutes = Math.round(absMs / MS_MIN);
    return rtf.format(sign * minutes, "minute");
  }
  if (absMs < MS_DAY) {
    const hours = Math.round(absMs / MS_HOUR);
    return rtf.format(sign * hours, "hour");
  }
  const days = Math.round(absMs / MS_DAY);
  return rtf.format(sign * days, "day");
}

/**
 * Day-bucket label for sticky activity-feed headers. Returns "Today" /
 * "Yesterday" for the obvious cases, else a short locale-aware date
 * (e.g. "Mon May 5" / "Pzt 5 May").
 */
export function formatDayLabel(
  date: Date | string,
  locale: SupportedLocale,
  now: Date = new Date(),
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round(
    (startOfDay(now) - startOfDay(d)) / MS_DAY,
  );

  if (dayDiff === 0) return locale === "tr" ? "Bugün" : "Today";
  if (dayDiff === 1) return locale === "tr" ? "Dün" : "Yesterday";

  return d.toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Group key (YYYY-MM-DD in user's local time) used to bucket activity
 * rows by day before rendering sticky headers. Stable string for use as
 * a Map key.
 */
export function dayKey(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
