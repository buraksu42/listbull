import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ListHeader } from "@/components/lists/list-header";
import { ItemList } from "@/components/lists/item-list";
import { MemberList } from "@/components/lists/member-list";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { listMembersForList } from "@/lib/db/queries/members";
import {
  getList,
  listItemsInList,
  userCanReadList,
} from "@/lib/db/queries/lists";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <Suspense fallback={<ListDetailHeaderSkeleton />}>
        <ListDetail listId={id} />
      </Suspense>
    </main>
  );
}

async function ListDetail({ listId }: { listId: string }) {
  const user = await requireUser();
  const canRead = await userCanReadList(user.id, listId);
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

      <ItemList
        listId={listId}
        initialItems={items}
        initialMembers={members}
      />
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
