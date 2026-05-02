import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActivityList } from "@/components/activity/activity-list";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { getList, userCanReadList } from "@/lib/db/queries/lists";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * Activity feed (B1) — Phase 3.
 *
 * Server-side shell: render the list header + back affordance, then
 * mount the polled `<ActivityList />` client view. Locale comes from
 * `users.locale` so the day labels and sentences match the rest of the
 * app per Phase 1's no-URL-prefix decision.
 */
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityScreen listId={id} />
      </Suspense>
    </main>
  );
}

async function ActivityScreen({ listId }: { listId: string }) {
  const user = await requireUser();
  const canRead = await userCanReadList(user.id, listId);
  if (!canRead) notFound();

  const list = await getList(listId);
  if (!list) notFound();

  const emoji = list.emoji ?? (list.isInbox ? "📥" : "📋");
  const title = list.isInbox ? "Inbox" : list.name;
  const locale = user.locale === "tr" ? "tr" : "en";

  return (
    <>
      <header
        style={{
          height: "var(--lb-header-h)",
          padding: "0 var(--lb-sp-4)",
          display: "flex",
          alignItems: "center",
          gap: "var(--lb-sp-3)",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <Link
          href={`/lists/${listId}`}
          aria-label="Back to list"
          className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--lb-r-md)] hover:bg-[var(--lb-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]"
          style={{ marginLeft: "calc(-1 * var(--lb-sp-3))" }}
        >
          <BackArrow />
        </Link>
        <span style={{ fontSize: "var(--lb-fs-xl)" }} aria-hidden>
          {emoji}
        </span>
        <h1
          style={{
            fontSize: "var(--lb-fs-xl)",
            fontWeight: "var(--lb-fw-semibold)",
            letterSpacing: "var(--lb-tracking-title)",
            flex: 1,
            minWidth: 0,
          }}
          className="truncate"
        >
          {locale === "tr" ? `${title} · Etkinlik` : `${title} · Activity`}
        </h1>
      </header>

      <ActivityList listId={listId} locale={locale} />
    </>
  );
}

function BackArrow() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ color: "var(--lb-muted-fg)" }}
    >
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function ActivitySkeleton() {
  return (
    <>
      <header
        style={{
          height: "var(--lb-header-h)",
          borderBottom: "1px solid var(--lb-border)",
        }}
      />
      <ListSkeleton />
    </>
  );
}
