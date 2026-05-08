/**
 * Phase 14c: user-preference-aware datetime formatter.
 *
 * Date order is hand-formatted (DD/MM/YYYY layouts vary by locale and
 * Intl can't be coerced to specific orderings). Time is formatted via
 * Intl.DateTimeFormat with `hour12` flag so the user's locale-aware
 * AM/PM separator is preserved.
 *
 * Timezone-aware throughout: `Intl.DateTimeFormat(..., { timeZone })`
 * extracts the zoned year/month/day before assembling the date string
 * so users in non-UTC zones see their local date even at the
 * boundaries.
 */
import type {
  AllowedDateFormat,
  AllowedTimeFormat,
} from "@/lib/validators/settings";

export type FormatDateOptions = {
  dateFormat: AllowedDateFormat;
  timeFormat: AllowedTimeFormat;
  /** IANA timezone name. Defaults to UTC if invalid. */
  timezone: string;
  locale: "tr" | "en";
  /** Which parts to render. Default: 'datetime'. */
  show?: "datetime" | "date" | "time";
};

export function formatDate(
  input: Date | string | number,
  opts: FormatDateOptions,
): string {
  const d =
    typeof input === "string"
      ? new Date(input)
      : input instanceof Date
        ? input
        : new Date(input);
  if (Number.isNaN(d.getTime())) return "";

  const intlLocale = opts.locale === "tr" ? "tr-TR" : "en-US";
  const tz = opts.timezone || "UTC";

  if (opts.show === "time") {
    return formatTimePart(d, opts.timeFormat, tz, intlLocale);
  }

  const dateStr = formatDatePart(d, opts.dateFormat, tz);
  if (opts.show === "date") return dateStr;

  const timeStr = formatTimePart(d, opts.timeFormat, tz, intlLocale);
  return `${dateStr} ${timeStr}`;
}

function formatDatePart(d: Date, fmt: AllowedDateFormat, tz: string): string {
  // en-CA gives ISO-style YYYY-MM-DD parts which we can re-shuffle.
  // formatToParts is timezone-aware so the year/month/day reflect
  // `tz` rather than the runtime's local zone.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const yy = parts.find((p) => p.type === "year")?.value ?? "0000";
  const mm = parts.find((p) => p.type === "month")?.value ?? "01";
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";
  switch (fmt) {
    case "DD.MM.YYYY":
      return `${dd}.${mm}.${yy}`;
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yy}`;
    case "YYYY-MM-DD":
      return `${yy}-${mm}-${dd}`;
  }
}

function formatTimePart(
  d: Date,
  fmt: AllowedTimeFormat,
  tz: string,
  intlLocale: string,
): string {
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: fmt === "12h",
    }).format(d);
  } catch {
    // Fallback: invalid timezone → render in UTC, ignoring fmt.
    return d.toISOString().slice(11, 16);
  }
}
