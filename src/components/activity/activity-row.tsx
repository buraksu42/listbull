"use client";

import * as React from "react";

import { ActivitySentence } from "@/components/activity/activity-sentence";
import { Avatar } from "@/components/lists/member-list";
import {
  formatRelativeTime,
  type SupportedLocale,
} from "@/lib/i18n/relative-time";
import type { ActivityFeedRow } from "@/lib/types";

/**
 * One activity row.
 *
 * Layout: actor avatar (28×28) · localized sentence · relative timestamp.
 * Tapping toggles a small "details" expand showing the raw timestamp
 * and entity id (debug-friendly, low-cost). Expand state is local —
 * collapsing doesn't lose any data because the row is fully rendered.
 */
export function ActivityRow({
  row,
  locale,
}: {
  row: ActivityFeedRow;
  locale: SupportedLocale;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const relative = formatRelativeTime(row.createdAt, locale);
  const absolute = new Date(row.createdAt).toLocaleString(
    locale === "tr" ? "tr-TR" : "en-US",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  return (
    <li
      style={{
        listStyle: "none",
        borderBottom: "1px solid var(--lb-border)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)] focus-visible:ring-inset"
        style={{ minHeight: 56 }}
      >
        <Avatar
          name={row.actorFirstName}
          photoUrl={row.actorPhotoUrl}
          size={28}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: "var(--lb-fs-md)",
              color: "var(--lb-fg)",
              lineHeight: 1.45,
              wordBreak: "break-word",
            }}
          >
            <ActivitySentence row={row} locale={locale} />
          </p>
          <p
            style={{
              fontSize: "var(--lb-fs-xs)",
              color: "var(--lb-muted-fg)",
              marginTop: 2,
            }}
            title={absolute}
          >
            {relative}
          </p>
          {expanded && (
            <dl
              className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
              style={{ color: "var(--lb-muted-fg)" }}
            >
              <dt>at</dt>
              <dd style={{ color: "var(--lb-fg)" }}>{absolute}</dd>
              <dt>action</dt>
              <dd style={{ color: "var(--lb-fg)" }}>{row.action}</dd>
            </dl>
          )}
        </div>
      </button>
    </li>
  );
}
