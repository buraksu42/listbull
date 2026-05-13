/**
 * Marketing site header — brand on the left, nav on the right.
 *
 * Lives at the top of every marketing surface (home, /install,
 * /features). Mirrors the footer nav order so users see the same
 * links twice — top for "I just landed", bottom for "I just
 * finished reading". Solid background (anti-list bans
 * glassmorphism), thin bottom border for separation.
 *
 * Not sticky — the homepage hero owns the first viewport, and a
 * persistent floating bar competes with that. Users scroll back
 * to top to navigate.
 */
import Link from "next/link";

import { BrandMark } from "@/components/marketing/brand-mark";
import { GITHUB_URL } from "@/components/marketing/links";

export function SiteHeader() {
  return (
    <header
      style={{
        width: "100%",
        background: "var(--lb-bg)",
        borderBottom: "1px solid var(--lb-border)",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "var(--lb-sp-4) var(--lb-sp-4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--lb-sp-4)",
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          aria-label="listbull home"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--lb-sp-2)",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          <BrandMark size={32} ariaLabel="listbull" />
          <span
            className="lb-wordmark"
            style={{
              fontSize: "var(--lb-fs-lg)",
              color: "var(--lb-ink-deep)",
            }}
          >
            listbull
          </span>
        </Link>

        <nav
          aria-label="primary"
          style={{
            display: "flex",
            gap: "var(--lb-sp-5)",
            fontSize: "var(--lb-fs-md)",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <Link href="/" style={navLinkStyle}>
            Home
          </Link>
          <Link href="/features" style={navLinkStyle}>
            Features
          </Link>
          <Link href="/install" style={navLinkStyle}>
            Install
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={navLinkStyle}
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

const navLinkStyle: React.CSSProperties = {
  color: "var(--lb-muted-fg)",
  textDecoration: "none",
};
