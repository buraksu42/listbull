import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ItemList } from "@/components/lists/item-list";
import { ListSkeleton } from "@/components/shared/list-skeleton";
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
    <main style={{ paddingBottom: "var(--lg-sp-12)" }}>
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

  const items = await listItemsInList(listId);
  const emoji = list.emoji ?? (list.isInbox ? "📥" : "📋");
  const title = list.isInbox ? "Inbox" : list.name;

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
        <span style={{ fontSize: "var(--lg-fs-xl)" }} aria-hidden>
          {emoji}
        </span>
        <h1
          style={{
            fontSize: "var(--lg-fs-xl)",
            fontWeight: "var(--lg-fw-semibold)",
            letterSpacing: "var(--lg-tracking-title)",
          }}
        >
          {title}
        </h1>
      </header>

      <ItemList listId={listId} initialItems={items} />
    </>
  );
}

function ListDetailHeaderSkeleton() {
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
      />
      <ListSkeleton />
    </>
  );
}
