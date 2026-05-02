import { ListChecks } from "lucide-react";
import { Suspense } from "react";

import { ListRow } from "@/components/lists/list-row";
import { EmptyState } from "@/components/shared/empty-state";
import { ListsListSkeleton } from "@/components/shared/list-skeleton";
import { listListsForUser } from "@/lib/db/queries/lists";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

export default function ListsPage() {
  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <header
        style={{
          height: "var(--lb-header-h)",
          padding: "0 var(--lb-sp-4)",
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <h1
          style={{
            fontSize: "var(--lb-fs-xl)",
            fontWeight: "var(--lb-fw-semibold)",
            letterSpacing: "var(--lb-tracking-title)",
          }}
        >
          Lists
        </h1>
      </header>

      <Suspense fallback={<ListsListSkeleton />}>
        <ListsContent />
      </Suspense>
    </main>
  );
}

async function ListsContent() {
  const user = await requireUser();
  const lists = await listListsForUser(user.id);

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
