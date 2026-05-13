/**
 * Renderer for the per-workspace daily digest message.
 *
 * Shared by `/today` command (on-demand) and the cron auto-push so
 * both surfaces output identical formatting.
 *
 * Telegram message cap is 4096 chars; we truncate long buckets and
 * append a "+N more" pointer if needed.
 */
import type {
  DigestItemRow,
  WorkspaceDailyDigest,
} from "@/lib/db/queries/workspace-digest";

const MAX_BUCKET_ROWS = 15;
const MAX_TEXT_LEN = 80;

export function renderDailyDigest(args: {
  digest: WorkspaceDailyDigest;
  workspaceName: string;
  timezone: string;
  locale: "tr" | "en";
  botUsername: string;
}): string {
  const { digest, workspaceName, timezone, locale, botUsername } = args;
  const today = formatLocalDate(new Date(), timezone, locale);

  const isEmpty =
    digest.dueToday.length === 0 &&
    digest.overdue.length === 0 &&
    digest.assignedOpen.length === 0;

  if (isEmpty) {
    return locale === "tr"
      ? `📅 ${today} — ${workspaceName}\n\nBugün için açık iş yok. ✨`
      : `📅 ${today} — ${workspaceName}\n\nNothing on the agenda. ✨`;
  }

  const lines: string[] = [];
  lines.push(`📅 ${today} — ${workspaceName}`);
  lines.push("━━━━━━━━━━━━━━━");

  if (digest.dueToday.length > 0) {
    lines.push("");
    lines.push(
      locale === "tr"
        ? `⏰ Bugün son tarih (${digest.dueToday.length})`
        : `⏰ Due today (${digest.dueToday.length})`,
    );
    appendBucket(lines, digest.dueToday, timezone, locale);
  }

  if (digest.overdue.length > 0) {
    lines.push("");
    lines.push(
      locale === "tr"
        ? `⚠️ Geciken (${digest.overdue.length})`
        : `⚠️ Overdue (${digest.overdue.length})`,
    );
    appendBucket(lines, digest.overdue, timezone, locale);
  }

  if (digest.assignedOpen.length > 0) {
    lines.push("");
    lines.push(
      locale === "tr"
        ? `👥 Açık atanmış işler (${digest.assignedOpen.length})`
        : `👥 Open assignments (${digest.assignedOpen.length})`,
    );
    appendBucket(lines, digest.assignedOpen, timezone, locale);
  }

  lines.push("");
  lines.push(
    locale === "tr"
      ? `📲 Mini App: t.me/${botUsername}/app`
      : `📲 Mini App: t.me/${botUsername}/app`,
  );

  return lines.join("\n");
}

function appendBucket(
  out: string[],
  rows: DigestItemRow[],
  timezone: string,
  locale: "tr" | "en",
): void {
  const visible = rows.slice(0, MAX_BUCKET_ROWS);
  for (const r of visible) {
    out.push(formatItemLine(r, timezone, locale));
  }
  if (rows.length > MAX_BUCKET_ROWS) {
    out.push(
      locale === "tr"
        ? `  … +${rows.length - MAX_BUCKET_ROWS} daha`
        : `  … +${rows.length - MAX_BUCKET_ROWS} more`,
    );
  }
}

function formatItemLine(
  r: DigestItemRow,
  timezone: string,
  locale: "tr" | "en",
): string {
  const emoji = r.listEmoji ?? "📋";
  const text =
    r.itemText.length > MAX_TEXT_LEN
      ? `${r.itemText.slice(0, MAX_TEXT_LEN)}…`
      : r.itemText;
  const parts = [`• ${text}`];
  parts.push(`— ${emoji} ${r.listName}`);
  if (r.assigneeUsername || r.assigneeFirstName) {
    const tag = r.assigneeUsername
      ? `@${r.assigneeUsername}`
      : r.assigneeFirstName ?? "";
    parts.push(`— ${tag}`);
  }
  if (r.deadlineAt) {
    const dl = formatLocalTime(r.deadlineAt, timezone, locale);
    parts.push(`— ${dl}`);
  }
  if (r.itemPriority === "high") {
    parts.unshift("🔥");
  }
  return parts.join(" ");
}

function formatLocalDate(
  d: Date,
  timezone: string,
  locale: "tr" | "en",
): string {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

function formatLocalTime(
  d: Date,
  timezone: string,
  locale: "tr" | "en",
): string {
  // If the deadline is at midnight local, render just the date; else
  // include time.
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const time = new Intl.DateTimeFormat(
    locale === "tr" ? "tr-TR" : "en-US",
    opts,
  ).format(d);
  return time === "00:00" ? "" : time;
}
