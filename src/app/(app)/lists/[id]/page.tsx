import { notFound } from "next/navigation";

import { ItemRow } from "@/components/lists/item-row";
import { EmptyState } from "@/components/shared/empty-state";
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
  const user = await requireUser();
  const { id } = await params;

  const canRead = await userCanReadList(user.id, id);
  if (!canRead) notFound();

  const list = await getList(id);
  if (!list) notFound();

  const items = await listItemsInList(id);
  const emoji = list.emoji ?? (list.isInbox ? "📥" : "📋");
  const title = list.isInbox ? "Inbox" : list.name;

  return (
    <main style={{ paddingBottom: "var(--lg-sp-12)" }}>
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

      {items.length === 0 ? (
        <EmptyState
          title="Empty list"
          description="Send a message to the bot to add an item."
        />
      ) : (
        <div role="list" aria-label={`${title} items`}>
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
