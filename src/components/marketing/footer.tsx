/**
 * Marketing footer — short, nav links + demo-bot disclosure.
 *
 * Nav order: Home / Features / Install / GitHub. Demo-bot disclosure is
 * a single muted line — the hosted @listbull_bot is a convenience, not
 * the canonical path. Self-host is the canonical path.
 */
import Link from "next/link";

import { GITHUB_URL } from "@/components/marketing/links";

type FooterProps = {
  hostedLabel: string;
  licenseLabel: string;
  copyrightLabel: string;
};

export function Footer({
  hostedLabel,
  licenseLabel,
  copyrightLabel,
}: FooterProps) {
  return (
    <footer
      style={{
        padding: "var(--lb-sp-10) var(--lb-sp-4) var(--lb-sp-8)",
        textAlign: "center",
        borderTop: "1px solid var(--lb-border)",
      }}
    >
      <nav
        aria-label="footer"
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "var(--lb-sp-5)",
          marginBottom: "var(--lb-sp-6)",
          fontSize: "var(--lb-fs-md)",
        }}
      >
        <Link href="/" style={{ color: "inherit" }}>
          Home
        </Link>
        <Link href="/features" style={{ color: "inherit" }}>
          Features
        </Link>
        <Link href="/install" style={{ color: "inherit" }}>
          Install
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "inherit" }}
        >
          GitHub
        </a>
      </nav>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-2)",
          fontSize: "var(--lb-fs-sm)",
          color: "var(--lb-muted-fg)",
        }}
      >
        <li>
          Demo:{" "}
          <a
            href="https://t.me/listbull_bot"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit" }}
          >
            @listbull_bot
          </a>{" "}
          — operator-hosted, 30-day data retention, not for production.
        </li>
        <li>{hostedLabel}</li>
        <li>{licenseLabel}</li>
        <li>{copyrightLabel}</li>
      </ul>
    </footer>
  );
}
