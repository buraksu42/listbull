import { notFound } from "next/navigation";

import { BrandMark } from "@/components/marketing/brand-mark";
import { GITHUB_URL } from "@/components/marketing/links";
import { getSnapshotPublic } from "@/lib/db/queries/snapshots";
import { env } from "@/lib/env";
import { verifySnapshotToken } from "@/lib/server/lists/snapshot-token";
import type { SnapshotPublic } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Snapshot · listbull",
  // Snapshot URLs are unlisted but stateless — they should be opened by
  // the recipient, not crawled.
  robots: { index: false, follow: false },
};

/**
 * D2 — public read-only list snapshot page.
 *
 * Verifies the HMAC-signed `?exp=&token=` query (Inv-18) before reading
 * any DB rows. Renders the list's CURRENT items (snapshot is generated
 * on-the-fly per request — Phase 4 schema-frozen contract).
 *
 * Light theme only (marketing surface), no theme adapter, no auth, no
 * interactive controls. The "Open in Telegram" CTA points at the bot
 * deeplink so recipients can hop into the live list if they're members.
 */
export default async function SnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const exp = readSingle(sp.exp);
  const token = readSingle(sp.token);

  const verdict = verifySnapshotToken(id, exp, token);
  if (!verdict.ok) {
    if (verdict.reason === "expired") {
      return <SnapshotExpired />;
    }
    notFound();
  }

  const expiresAtIso = new Date(Number(exp)).toISOString();
  const snapshot = await getSnapshotPublic(id, expiresAtIso);
  if (!snapshot) notFound();

  return <SnapshotView snapshot={snapshot} />;
}

function readSingle(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? null;
  return null;
}

function SnapshotView({ snapshot }: { snapshot: SnapshotPublic }) {
  const botUsername = env.TELEGRAM_BOT_USERNAME ?? "listbull_bot";
  const botUrl = `https://t.me/${botUsername}`;
  const capturedDate = new Date(snapshot.capturedAt).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
    },
  );

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--lb-bg)",
        color: "var(--lb-fg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <article
        style={{
          maxWidth: 640,
          width: "100%",
          margin: "0 auto",
          padding: "var(--lb-sp-10) var(--lb-sp-4) var(--lb-sp-6)",
          flex: 1,
        }}
      >
        <header
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--lb-sp-3)",
            textAlign: "center",
            marginBottom: "var(--lb-sp-6)",
          }}
        >
          <span
            aria-hidden
            style={{
              fontSize: 56,
              lineHeight: 1,
            }}
          >
            {snapshot.listEmoji ?? "📋"}
          </span>
          <h1
            style={{
              fontSize: "var(--lb-fs-3xl)",
              fontWeight: "var(--lb-fw-bold)",
              letterSpacing: "var(--lb-tracking-title)",
            }}
          >
            {snapshot.listName}
          </h1>
          <p
            style={{
              fontSize: "var(--lb-fs-md)",
              color: "var(--lb-muted-fg)",
            }}
          >
            {`Captured by ${snapshot.ownerFirstName} on ${capturedDate}`}
          </p>
        </header>

        <ul
          role="list"
          aria-label={snapshot.listName}
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            border: "1px solid var(--lb-border)",
            borderRadius: "var(--lb-r-lg)",
            overflow: "hidden",
            background: "var(--lb-paper)",
          }}
        >
          {snapshot.items.length === 0 ? (
            <li
              role="listitem"
              style={{
                padding: "var(--lb-sp-6)",
                textAlign: "center",
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-md)",
              }}
            >
              No items.
            </li>
          ) : (
            snapshot.items.map((item, idx) => (
              <li
                key={idx}
                role="listitem"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--lb-sp-3)",
                  padding: "var(--lb-sp-3) var(--lb-sp-4)",
                  borderBottom:
                    idx === snapshot.items.length - 1
                      ? "none"
                      : "1px solid var(--lb-border)",
                  minHeight: 48,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `2px solid ${
                      item.isDone
                        ? "var(--lb-accent)"
                        : "var(--lb-muted-fg)"
                    }`,
                    background: item.isDone
                      ? "var(--lb-accent)"
                      : "transparent",
                    borderRadius: "var(--lb-r-full)",
                    flexShrink: 0,
                  }}
                >
                  {item.isDone && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M2 6.5l2.5 2.5L10 3.5"
                        stroke="var(--lb-accent-fg)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: "var(--lb-fs-md)",
                    textDecoration: item.isDone ? "line-through" : "none",
                    color: item.isDone
                      ? "var(--lb-muted-fg)"
                      : "var(--lb-fg)",
                  }}
                >
                  {item.text}
                </span>
              </li>
            ))
          )}
        </ul>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "var(--lb-sp-6)",
          }}
        >
          <a
            href={botUrl}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--lb-sp-2)",
              padding: "var(--lb-sp-3) var(--lb-sp-6)",
              minHeight: "var(--lb-tap-target)",
              borderRadius: "var(--lb-r-full)",
              background: "var(--lb-accent)",
              color: "var(--lb-accent-fg)",
              fontWeight: "var(--lb-fw-semibold)",
              textDecoration: "none",
            }}
          >
            Open in Telegram
          </a>
        </div>
      </article>

      <footer
        style={{
          padding: "var(--lb-sp-6) var(--lb-sp-4)",
          textAlign: "center",
          borderTop: "1px solid var(--lb-border)",
          color: "var(--lb-muted-fg)",
          fontSize: "var(--lb-fs-sm)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-1)",
          alignItems: "center",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--lb-sp-2)",
          }}
        >
          Made with
          <BrandMark size={20} />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", fontWeight: "var(--lb-fw-medium)" }}
          >
            listbull
          </a>
        </span>
      </footer>
    </main>
  );
}

function SnapshotExpired() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "var(--lb-sp-12) var(--lb-sp-4)",
        background: "var(--lb-bg)",
        color: "var(--lb-fg)",
      }}
    >
      <section style={{ maxWidth: 480, textAlign: "center" }}>
        <BrandMark size={56} />
        <h1
          style={{
            fontSize: "var(--lb-fs-2xl)",
            fontWeight: "var(--lb-fw-bold)",
            marginTop: "var(--lb-sp-4)",
          }}
        >
          This snapshot has expired
        </h1>
        <p
          style={{
            color: "var(--lb-muted-fg)",
            marginTop: "var(--lb-sp-2)",
            fontSize: "var(--lb-fs-md)",
          }}
        >
          Ask the owner to share a fresh link.
        </p>
      </section>
    </main>
  );
}
