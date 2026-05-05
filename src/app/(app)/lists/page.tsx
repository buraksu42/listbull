import { ListChecks } from "lucide-react";
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

      <ListsBody lists={lists} />
    </>
  );
}

type ListsBodyProps = {
  lists: Awaited<ReturnType<typeof listListsForUser>>;
};

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
