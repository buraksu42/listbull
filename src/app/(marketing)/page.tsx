import Link from "next/link";

import { env } from "@/lib/env";

export const metadata = {
  title: "listgram — Telegram-native AI list assistant",
  description:
    "Open source, self-hostable, BYOK. Chat your todos into Telegram, manage in a Mini App.",
};

export default function MarketingHome() {
  const botUrl =
    env.NEXT_PUBLIC_ENV === "production"
      ? `https://t.me/${env.TELEGRAM_BOT_USERNAME ?? "listgram_bot"}?start=marketing`
      : "#";

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "var(--lg-sp-12) var(--lg-sp-4)",
        background: "var(--lg-bg)",
        color: "var(--lg-fg)",
      }}
    >
      <section
        style={{
          maxWidth: 640,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "var(--lg-sp-6)",
        }}
      >
        <span
          className="lg-wordmark"
          style={{
            fontSize: "var(--lg-fs-3xl)",
            color: "var(--lg-accent)",
          }}
        >
          listgram
        </span>
        <h1
          style={{
            fontSize: "var(--lg-fs-4xl)",
            fontWeight: "var(--lg-fw-bold)",
            letterSpacing: "var(--lg-tracking-title)",
            lineHeight: 1.15,
          }}
        >
          Your todos, in Telegram.
        </h1>
        <p
          style={{
            fontSize: "var(--lg-fs-xl)",
            color: "var(--lg-muted-fg)",
            lineHeight: 1.5,
          }}
        >
          A chatty bot that captures and manages your lists. A Mini App for
          when you want to see them. Bring your own AI key — open source,
          self-hostable.
        </p>
        <div>
          <Link
            href={botUrl}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--lg-sp-2)",
              padding: "var(--lg-sp-3) var(--lg-sp-6)",
              minHeight: "var(--lg-tap-target)",
              borderRadius: "var(--lg-r-full)",
              background: "var(--lg-accent)",
              color: "var(--lg-accent-fg)",
              fontWeight: "var(--lg-fw-semibold)",
              textDecoration: "none",
            }}
          >
            Open in Telegram
          </Link>
        </div>
        <footer
          style={{
            marginTop: "var(--lg-sp-12)",
            fontSize: "var(--lg-fs-sm)",
            color: "var(--lg-muted-fg)",
          }}
        >
          <a
            href="https://github.com/buraksu42/listgram"
            style={{ color: "inherit" }}
          >
            github.com/buraksu42/listgram
          </a>
        </footer>
      </section>
    </main>
  );
}
