import { CalendarCheck, CalendarDays, LayoutGrid, ListChecks } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { Suspense } from "react";

import { ListRow } from "@/components/lists/list-row";
import { EmptyState } from "@/components/shared/empty-state";
import { ListsListSkeleton } from "@/components/shared/list-skeleton";
import { WorkspaceSwitcher } from "@/components/workspace/switcher";
import { listListsForUser } from "@/lib/db/queries/lists";
import {
  listWorkspacesForUser,
  resolveActiveWorkspaceId,
} from "@/lib/db/queries/workspaces";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

export default function ListsPage() {
  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <Suspense fallback={<ListsListSkeleton />}>
        <ListsContent />
      </Suspense>
    </main>
  );
}

async function ListsContent() {
  const user = await requireUser();
  const [workspaceId, workspaces] = await Promise.all([
    resolveActiveWorkspaceId(user.id),
    listWorkspacesForUser(user.id),
  ]);
  const lists = await listListsForUser(user.id, workspaceId);

  return (
    <>
      <header
        style={{
          height: "var(--lb-header-h)",
          padding: "0 var(--lb-sp-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--lb-sp-2)",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <WorkspaceSwitcher workspaces={workspaces} />
      </header>

      <nav
        aria-label="Smart views"
        style={{
          display: "flex",
          gap: "var(--lb-sp-2)",
          padding: "var(--lb-sp-2) var(--lb-sp-3)",
          borderBottom: "1px solid var(--lb-border)",
          overflowX: "auto",
        }}
      >
        <SmartViewLink
          href="/views/today"
          icon={<CalendarCheck className="h-3.5 w-3.5" aria-hidden />}
          label="Bugün"
        />
        <SmartViewLink
          href="/views/week"
          icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}
          label="Hafta"
        />
        <SmartViewLink
          href="/views/board"
          icon={<LayoutGrid className="h-3.5 w-3.5" aria-hidden />}
          label="Pano"
        />
      </nav>

      <ListsBody lists={lists} />
    </>
  );
}

type ListsBodyProps = {
  lists: Awaited<ReturnType<typeof listListsForUser>>;
};

function SmartViewLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--lb-sp-1)",
        padding: "var(--lb-sp-1) var(--lb-sp-2)",
        borderRadius: "9999px",
        border: "1px solid var(--lb-border)",
        color: "var(--lb-fg)",
        fontSize: "var(--lb-fs-xs)",
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
    </Link>
  );
}

function ListsBody({ lists }: ListsBodyProps) {

  if (lists.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks className="h-6 w-6" aria-hidden />}
        title="No lists yet"
        description="Send /start to the bot to create your Inbox."
      />
    );
  }

  return (
    <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {lists.map((list) => (
        <li key={list.id}>
          <ListRow list={list} />
        </li>
      ))}
    </ul>
  );
}
