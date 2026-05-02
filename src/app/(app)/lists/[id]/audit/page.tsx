import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AuditList } from "@/components/audit/audit-list";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { getList } from "@/lib/db/queries/lists";
import { isListOwner } from "@/lib/db/queries/members";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * F2 — owner-only audit & restore screen.
 *
 * Server gate: only the list owner sees this page. Non-owners (editors
 * and viewers) get redirected back to the list view; non-members hit
 * `notFound()` for the same reason `userCanReadList` returns false.
 *
 * The route renders a thin server shell (header + back affordance) and
 * mounts the polled `<AuditList />` client component. Backend is the
 * source of truth for `canRestore` (Inv-21 30-day window enforcement).
 */
export default async function AuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main style={{ paddingBottom: "var(--lg-sp-12)" }}>
      <Suspense fallback={<AuditSkeleton />}>
        <AuditScreen listId={id} />
      </Suspense>
    </main>
  );
}

async function AuditScreen({ listId }: { listId: string }) {
  const user = await requireUser();
  const isOwner = await isListOwner(listId, user.id);
  if (!isOwner) {
    // Non-owner: bounce back to the list view (or hit not-found if the
    // list itself is inaccessible).
    const list = await getList(listId);
    if (!list) notFound();
    redirect(`/lists/${listId}`);
  }

  const list = await getList(listId);
  if (!list) notFound();

  const emoji = list.emoji ?? (list.isInbox ? "📥" : "📋");
  const title = list.isInbox ? "Inbox" : list.name;
  const locale = user.locale === "tr" ? "tr" : "en";

  const t = await getTranslations("audit");

  return (
    <>
      <header
        style={{
          height: "var(--lg-header-h)",
          padding: "0 var(--lg-sp-4)",
          display: "flex",
          alignItems: "center",
          gap: "var(--lg-sp-3)",
          borderBottom: "1px solid var(--lg-border)",
        }}
      >
        <Link
          href={`/lists/${listId}`}
          aria-label="Back to list"
          className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--lg-r-md)] hover:bg-[var(--lg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)]"
          style={{ marginLeft: "calc(-1 * var(--lg-sp-3))" }}
        >
          <BackArrow />
        </Link>
        <span style={{ fontSize: "var(--lg-fs-xl)" }} aria-hidden>
          {emoji}
        </span>
        <h1
          style={{
            fontSize: "var(--lg-fs-xl)",
            fontWeight: "var(--lg-fw-semibold)",
            letterSpacing: "var(--lg-tracking-title)",
            flex: 1,
            minWidth: 0,
          }}
          className="truncate"
        >
          {`${title} · ${t("title")}`}
        </h1>
      </header>

      <AuditList
        listId={listId}
        locale={locale}
        labels={{
          filterAll: t("filterAll"),
          filterDeletions: t("filterDeletions"),
          filterEdits: t("filterEdits"),
          filterPermissions: t("filterPermissions"),
          filterGroupLabel: t("title"),
          empty: t("empty"),
          emptyDescription: t("emptyDescription"),
          loadMore: t("loadMore"),
          loading: t("loading"),
          loadFailed: t("loadFailed"),
          restore: t("restoreButton"),
          restoring: t("restoring"),
          restored: locale === "tr" ? "Öğe geri yüklendi." : "Item restored.",
          restoreFailed:
            locale === "tr"
              ? "Geri yüklenemedi — tekrar dene."
              : "Couldn't restore — try again.",
          restoreUnavailable: t("restoreUnavailable"),
        }}
      />
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
      style={{ color: "var(--lg-muted-fg)" }}
    >
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function AuditSkeleton() {
  return (
    <>
      <header
        style={{
          height: "var(--lg-header-h)",
          borderBottom: "1px solid var(--lg-border)",
        }}
      />
      <ListSkeleton />
    </>
  );
}
