import * as React from "react";

import { ItemPill } from "@/components/activity/item-pill";
import type { ActivityAction, ActivityFeedRow } from "@/lib/types";

/**
 * Localized human sentence for one activity row.
 *
 * Backend hands us raw `(action, payloadBefore, payloadAfter,
 * actorName)` and lets the client pick the localized template per
 * `users.locale`. Coverage spans every value of `ActivityAction`
 * (16 cases — see `src/lib/types/index.ts`).
 *
 * Payloads are typed as `unknown` at the row boundary; we narrow per
 * `entityType`. Item snapshots include `text`; member snapshots include
 * `user.telegramFirstName`; list snapshots include `name`. Anything
 * missing falls back to a generic phrasing.
 */
type SnapshotItem = { text?: string | null } | null | undefined;
type SnapshotMember = {
  user?: {
    telegramFirstName?: string | null;
    telegramUsername?: string | null;
  };
  role?: string;
} | null | undefined;
type SnapshotList = { name?: string | null } | null | undefined;

function snapshotAs<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;
  return value as T;
}

export function ActivitySentence({
  row,
  locale,
}: {
  row: ActivityFeedRow;
  locale: "tr" | "en";
}) {
  const actor = (
    <strong style={{ fontWeight: "var(--lb-fw-semibold)" }}>
      {row.actorFirstName}
    </strong>
  );

  const after = snapshotAs<SnapshotItem & SnapshotMember & SnapshotList>(
    row.payloadAfter,
  );
  const before = snapshotAs<SnapshotItem & SnapshotMember & SnapshotList>(
    row.payloadBefore,
  );

  switch (row.action) {
    // ─── items ──────────────────────────────────────────────────────
    case "item_created":
      return template(locale, {
        en: <>{actor} added {pillItem(after)}</>,
        tr: <>{actor} {pillItem(after)} ekledi</>,
      });
    case "item_completed":
      return template(locale, {
        en: <>{actor} completed {pillItem(after ?? before)}</>,
        tr: <>{actor} {pillItem(after ?? before)} tamamladı</>,
      });
    case "item_uncompleted":
      return template(locale, {
        en: <>{actor} re-opened {pillItem(after ?? before)}</>,
        tr: <>{actor} {pillItem(after ?? before)} tekrar açtı</>,
      });
    case "item_edited":
      return template(locale, {
        en: <>{actor} edited {pillItem(after ?? before)}</>,
        tr: <>{actor} {pillItem(after ?? before)} düzenledi</>,
      });
    case "item_deleted":
      return template(locale, {
        en: <>{actor} deleted {pillItem(before ?? after)}</>,
        tr: <>{actor} {pillItem(before ?? after)} sildi</>,
      });
    case "item_assigned":
      return template(locale, {
        en: <>{actor} assigned {pillItem(after ?? before)}</>,
        tr: <>{actor} {pillItem(after ?? before)} atadı</>,
      });
    case "item_unassigned":
      return template(locale, {
        en: <>{actor} unassigned {pillItem(after ?? before)}</>,
        tr: <>{actor} {pillItem(after ?? before)} atamasını kaldırdı</>,
      });
    case "item_due_set":
      return template(locale, {
        en: (
          <>
            {actor} set a reminder on {pillItem(after ?? before)}
          </>
        ),
        tr: (
          <>
            {actor} {pillItem(after ?? before)} için hatırlatıcı kurdu
          </>
        ),
      });
    case "item_due_cleared":
      return template(locale, {
        en: (
          <>
            {actor} cleared the reminder on {pillItem(after ?? before)}
          </>
        ),
        tr: (
          <>
            {actor} {pillItem(after ?? before)} hatırlatıcısını temizledi
          </>
        ),
      });

    // ─── lists ──────────────────────────────────────────────────────
    case "list_created":
      return template(locale, {
        en: <>{actor} created the list {nameOf(after)}</>,
        tr: <>{actor} {nameOf(after)} listesini oluşturdu</>,
      });
    case "list_renamed":
      return template(locale, {
        en: (
          <>
            {actor} renamed the list to <em>{nameOf(after)}</em>
          </>
        ),
        tr: (
          <>
            {actor} listeyi <em>{nameOf(after)}</em> olarak yeniden adlandırdı
          </>
        ),
      });
    case "list_archived":
      return template(locale, {
        en: <>{actor} archived the list</>,
        tr: <>{actor} listeyi arşivledi</>,
      });
    case "list_restored":
      return template(locale, {
        en: <>{actor} restored the list</>,
        tr: <>{actor} listeyi geri yükledi</>,
      });

    // ─── members ────────────────────────────────────────────────────
    case "member_added":
      return template(locale, {
        en: <>{actor} added {memberOf(after)}</>,
        tr: <>{actor} {memberOf(after)} kullanıcısını ekledi</>,
      });
    case "member_removed":
      return template(locale, {
        en: <>{actor} removed {memberOf(before)}</>,
        tr: <>{actor} {memberOf(before)} kullanıcısını çıkardı</>,
      });
    case "member_role_changed":
      return template(locale, {
        en: (
          <>
            {actor} changed {memberOf(after)}&apos;s role to {roleOf(after)}
          </>
        ),
        tr: (
          <>
            {actor} {memberOf(after)} rolünü {roleOf(after)} olarak değiştirdi
          </>
        ),
      });
  }
}

function template(
  locale: "tr" | "en",
  parts: { en: React.ReactNode; tr: React.ReactNode },
): React.ReactElement {
  return <>{locale === "tr" ? parts.tr : parts.en}</>;
}

function pillItem(snap: SnapshotItem): React.ReactElement {
  return <ItemPill text={snap?.text ?? ""} />;
}

function nameOf(snap: SnapshotList): React.ReactElement {
  return <ItemPill text={snap?.name ?? ""} />;
}

function memberOf(snap: SnapshotMember): React.ReactElement {
  const fn = snap?.user?.telegramFirstName ?? snap?.user?.telegramUsername ?? "?";
  return (
    <strong style={{ fontWeight: "var(--lb-fw-medium)" }}>{fn}</strong>
  );
}

function roleOf(snap: SnapshotMember): string {
  return snap?.role ?? "—";
}

// Sanity check at type-check time: switch above must cover every
// ActivityAction. (TS narrows row.action exhaustively in the switch.)
const _exhaust = (_: never): never => _;
function _coverage(a: ActivityAction): React.ReactNode {
  switch (a) {
    case "item_created":
    case "item_completed":
    case "item_uncompleted":
    case "item_edited":
    case "item_deleted":
    case "item_assigned":
    case "item_unassigned":
    case "item_due_set":
    case "item_due_cleared":
    case "list_created":
    case "list_renamed":
    case "list_archived":
    case "list_restored":
    case "member_added":
    case "member_removed":
    case "member_role_changed":
      return null;
    default:
      return _exhaust(a);
  }
}
void _coverage;
