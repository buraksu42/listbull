import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ListHeader } from "@/components/lists/list-header";
import { ItemList } from "@/components/lists/item-list";
import { ListViewToggle } from "@/components/lists/list-view-toggle";
import { MemberList } from "@/components/lists/member-list";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { KanbanBoard } from "@/components/views/kanban-board";
import { listMembersForList } from "@/lib/db/queries/members";
import {
  getList,
  listItemsInList,
  userCanReadList,
} from "@/lib/db/queries/lists";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

export default async function ListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const view: "list" | "board" = sp.view === "board" ? "board" : "list";

  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <Suspense fallback={<ListDetailHeaderSkeleton />}>
        <ListDetail listId={id} view={view} />
      </Suspense>
    </main>
  );
}

async function ListDetail({
  listId,
  view,
}: {
  listId: string;
  view: "list" | "board";
}) {
  const user = await requireUser();
  const workspaceId = await resolveActiveWorkspaceId(user.id);
  const canRead = await userCanReadList(user.id, listId, workspaceId);
  if (!canRead) notFound();

  const list = await getList(listId);
  if (!list) notFound();

  // Phase 3: parallelize items + members so the share affordance and
  // assignee badges have data on first paint without waterfalls.
  const [items, members] = await Promise.all([
    listItemsInList(listId),
    listMembersForList(listId),
  ]);

  const callerMember = members.find((m) => m.userId === user.id);
  const currentUserRole =
    (callerMember?.role as "owner" | "editor" | "viewer" | undefined) ?? "viewer";

  const emoji = list.emoji ?? (list.isInbox ? "📥" : "📋");
  const title = list.isInbox ? "Inbox" : list.name;

  return (
    <>
      <ListHeader
        listId={listId}
        listName={title}
        emoji={emoji}
        isInbox={list.isInbox}
        currentUserRole={currentUserRole}
      />

      {!list.isInbox && (
        <MemberList
          listId={listId}
          initialMembers={members}
          currentUserRole={currentUserRole}
        />
      )}

      <div
        style={{
          padding: "var(--lb-sp-2) var(--lb-sp-4)",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <ListViewToggle listId={listId} current={view} />
      </div>

      {view === "board" ? (
        <KanbanBoard
          cacheKey={["items", listId]}
          items={items}
          canWrite={
            currentUserRole === "owner" || currentUserRole === "editor"
          }
        />
      ) : (
        <ItemList
          listId={listId}
          initialItems={items}
          initialMembers={members}
        />
      )}
    </>
  );
}

function ListDetailHeaderSkeleton() {
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
      />
      <ListSkeleton />
    </>
  );
}
