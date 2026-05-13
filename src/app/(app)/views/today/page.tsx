import { CalendarCheck } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { listWorkspacesForUser } from "@/lib/db/queries/workspaces";
import {
  getWorkspaceDailyDigest,
  type DigestItemRow,
  type WorkspaceDailyDigest,
} from "@/lib/db/queries/workspace-digest";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * Today smart view — Phase 16/#27: per-workspace breakdown.
 *
 * Every workspace the caller is a member of gets its own section
 * (sorted: Personal first, then by created_at ASC — same as the
 * workspace switcher). Each section renders the same 3 buckets as
 * the bot `/today` command so the two surfaces stay consistent:
 *   - ⏰ Due today
 *   - ⚠️ Overdue (≤7d)
 *   - 👥 Open assignments (no deadline / future, assigned)
 *
 * Empty workspaces are HIDDEN (no "nothing here" noise — switcher
 * already shows the workspace exists). If ALL workspaces are empty
 * we fall through to the empty-state.
 */
export default async function TodayPage() {
  const user = await requireUser();
  const workspaces = await listWorkspacesForUser(user.id);
  const tz = user.timezone || "UTC";

  type SectionData = {
    id: string;
    name: string;
    isPersonal: boolean;
    digest: WorkspaceDailyDigest;
  };

  const sections: SectionData[] = await Promise.all(
    workspaces.map(async (w) => ({
      id: w.id,
      name: w.name,
      isPersonal: w.isPersonal,
      digest: await getWorkspaceDailyDigest({
        userId: user.id,
        workspaceId: w.id,
        timezone: tz,
      }),
    })),
  );

  const nonEmpty = sections.filter((s) => bucketCount(s.digest) > 0);

  if (nonEmpty.length === 0) {
    return (
      <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
        <Header label={user.locale === "tr" ? "Bugün" : "Today"} />
        <EmptyState
          icon={<CalendarCheck className="h-6 w-6" aria-hidden />}
          title={
            user.locale === "tr"
              ? "Bugün için iş yok"
              : "Nothing on the agenda"
          }
          description={
            user.locale === "tr"
              ? "Deadline ekle veya bir item'ı assign et — bugünün listesinde burada görünür."
              : "Add a deadline or assign an item — today's work shows up here."
          }
        />
      </main>
    );
  }

  const totalCount = nonEmpty.reduce(
    (acc, s) => acc + bucketCount(s.digest),
    0,
  );

  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <Header
        label={user.locale === "tr" ? "Bugün" : "Today"}
        right={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--lb-sp-3)",
              color: "var(--lb-muted-fg)",
              fontSize: "var(--lb-fs-sm)",
            }}
          >
            <span>
              {totalCount} {user.locale === "tr" ? "iş" : `item${totalCount === 1 ? "" : "s"}`}
            </span>
            <Link
              href="/views/week"
              style={{
                color: "var(--lb-accent)",
                textDecoration: "none",
              }}
            >
              {user.locale === "tr" ? "Bu hafta →" : "This week →"}
            </Link>
          </span>
        }
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-3)",
          padding: "var(--lb-sp-4)",
        }}
      >
        {nonEmpty.map((s) => (
          <WorkspaceSection
            key={s.id}
            workspaceId={s.id}
            workspaceName={s.name}
            isPersonal={s.isPersonal}
            digest={s.digest}
            locale={user.locale === "tr" ? "tr" : "en"}
            timezone={tz}
          />
        ))}
      </div>
    </main>
  );
}

function bucketCount(d: WorkspaceDailyDigest): number {
  return d.dueToday.length + d.overdue.length + d.assignedOpen.length;
}

function Header({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <header
      style={{
        height: "var(--lb-header-h)",
        padding: "0 var(--lb-sp-4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid var(--lb-border)",
      }}
    >
      <h1
        style={{
          fontSize: "var(--lb-fs-xl)",
          fontWeight: "var(--lb-fw-semibold)",
        }}
      >
        {label}
      </h1>
      {right}
    </header>
  );
}

function WorkspaceSection({
  workspaceId,
  workspaceName,
  isPersonal,
  digest,
  locale,
  timezone,
}: {
  workspaceId: string;
  workspaceName: string;
  isPersonal: boolean;
  digest: WorkspaceDailyDigest;
  locale: "tr" | "en";
  timezone: string;
}) {
  const count = bucketCount(digest);
  return (
    <section
      aria-labelledby={`ws-${workspaceId}`}
      style={{
        background: "var(--lb-card)",
        border: "1px solid var(--lb-border)",
        borderRadius: "var(--lb-r-lg)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "var(--lb-sp-3) var(--lb-sp-4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <h2
          id={`ws-${workspaceId}`}
          style={{
            fontSize: "var(--lb-fs-lg)",
            fontWeight: "var(--lb-fw-semibold)",
            display: "flex",
            alignItems: "center",
            gap: "var(--lb-sp-2)",
          }}
        >
          <span aria-hidden>📁</span>
          {workspaceName}
          {isPersonal && (
            <span
              style={{
                fontSize: "var(--lb-fs-xs)",
                color: "var(--lb-muted-fg)",
                fontWeight: "var(--lb-fw-normal)",
              }}
            >
              ({locale === "tr" ? "kişisel" : "personal"})
            </span>
          )}
        </h2>
        <span
          style={{
            fontSize: "var(--lb-fs-sm)",
            color: "var(--lb-muted-fg)",
          }}
        >
          {count}
        </span>
      </header>

      {digest.dueToday.length > 0 && (
        <Bucket
          label={locale === "tr" ? "⏰ Bugün son tarih" : "⏰ Due today"}
          rows={digest.dueToday}
          timezone={timezone}
        />
      )}
      {digest.overdue.length > 0 && (
        <Bucket
          label={locale === "tr" ? "⚠️ Geciken" : "⚠️ Overdue"}
          rows={digest.overdue}
          timezone={timezone}
        />
      )}
      {digest.assignedOpen.length > 0 && (
        <Bucket
          label={
            locale === "tr"
              ? "👥 Açık atanmış işler"
              : "👥 Open assignments"
          }
          rows={digest.assignedOpen}
          timezone={timezone}
        />
      )}
    </section>
  );
}

function Bucket({
  label,
  rows,
  timezone,
}: {
  label: string;
  rows: DigestItemRow[];
  timezone: string;
}) {
  return (
    <div>
      <div
        style={{
          padding: "var(--lb-sp-2) var(--lb-sp-4)",
          fontSize: "var(--lb-fs-xs)",
          letterSpacing: "0.04em",
          color: "var(--lb-muted-fg)",
          background: "var(--lb-paper)",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        {label} ({rows.length})
      </div>
      <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <li
            key={r.itemId}
            style={{
              padding: "var(--lb-sp-3) var(--lb-sp-4)",
              borderBottom: "1px solid var(--lb-border)",
            }}
          >
            <Link
              href={`/lists/${r.listId}`}
              style={{
                display: "flex",
                gap: "var(--lb-sp-3)",
                alignItems: "center",
                color: "var(--lb-fg)",
                textDecoration: "none",
              }}
            >
              <span style={{ fontSize: "var(--lb-fs-lg)" }}>
                {r.listEmoji ?? "📋"}
              </span>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div
                  style={{
                    fontSize: "var(--lb-fs-base)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.itemPriority === "high" && "🔥 "}
                  {r.itemText}
                </div>
                <div
                  style={{
                    fontSize: "var(--lb-fs-xs)",
                    color: "var(--lb-muted-fg)",
                  }}
                >
                  {r.listName}
                  {r.assigneeUsername && (
                    <> · @{r.assigneeUsername}</>
                  )}
                  {!r.assigneeUsername && r.assigneeFirstName && (
                    <> · {r.assigneeFirstName}</>
                  )}
                  {r.deadlineAt && (
                    <> · {formatTime(r.deadlineAt, timezone)}</>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTime(date: Date, timezone: string): string {
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return time === "00:00" ? "" : time;
}
