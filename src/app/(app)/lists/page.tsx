import { listListsForUser } from "@/lib/db/queries/lists";
import { requireUser } from "@/lib/server/auth/require-user";
import { ListRow } from "@/components/lists/list-row";
import { EmptyState } from "@/components/shared/empty-state";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const user = await requireUser();
  const lists = await listListsForUser(user.id);

  return (
    <main style={{ paddingBottom: "var(--lg-sp-12)" }}>
      <header
        style={{
          height: "var(--lg-header-h)",
          padding: "0 var(--lg-sp-4)",
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--lg-border)",
        }}
      >
        <h1
          style={{
            fontSize: "var(--lg-fs-xl)",
            fontWeight: "var(--lg-fw-semibold)",
            letterSpacing: "var(--lg-tracking-title)",
          }}
        >
          Lists
        </h1>
      </header>

      {lists.length === 0 ? (
        <EmptyState
          title="No lists yet"
          description="Send /start to the bot to create your Inbox."
        />
      ) : (
        <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {lists.map((list) => (
            <li key={list.id}>
              <ListRow list={list} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
