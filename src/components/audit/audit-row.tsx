"use client";

/**
 * a11y: each row is announced via the parent `<ul role="list">` /
 * `role="listitem"` pair. The activity sentence is rendered as plain
 * text inside `<p>`; the timestamp uses a `<time dateTime>` element so
 * assistive tech can re-format. Restore button label includes the item
 * text per the screen-reader convention "Restore <item>".
 */
import * as React from "react";

import { ActivitySentence } from "@/components/activity/activity-sentence";
import { RestoreButton } from "@/components/audit/restore-button";
import { Avatar } from "@/components/lists/member-list";
import {
  formatRelativeTime,
  type SupportedLocale,
} from "@/lib/i18n/relative-time";
import type { AuditEntryWithRestore } from "@/lib/types";

type AuditRowProps = {
  row: AuditEntryWithRestore;
  listId: string;
  locale: SupportedLocale;
  restoreLabels: {
    restore: string;
    restoring: string;
    restored: string;
    failed: string;
    unavailable: string;
  };
};

export function AuditRow({
  row,
  listId,
  locale,
  restoreLabels,
}: AuditRowProps) {
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

  // Item text for restore-button aria-label — pulled from the
  // `payload_before` snapshot (deletion preserves the original text).
  const itemText = readItemText(row.payloadBefore) ?? "";

  return (
    <li
      style={{
        listStyle: "none",
        borderBottom: "1px solid var(--lb-border)",
      }}
    >
      <div
        className="flex items-start gap-3 px-4 py-3"
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
          >
            <time dateTime={row.createdAt} title={absolute}>
              {relative}
            </time>
          </p>
        </div>
        {row.action === "item_deleted" && (
          <div className="shrink-0 self-center">
            <RestoreButton
              listId={listId}
              activityLogId={row.id}
              itemText={itemText}
              canRestore={row.canRestore}
              labels={restoreLabels}
            />
          </div>
        )}
      </div>
    </li>
  );
}

function readItemText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}
