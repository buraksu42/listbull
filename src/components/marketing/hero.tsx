/**
 * Marketing landing hero — light-only surface.
 *
 * Anti-list strict: no glassmorphism, no gradient text, no neon glow, no
 * cosmic imagery, no stock illustrations. Just the brand mark + wordmark
 * + tagline + subtitle + two CTAs (Open in Telegram, View on GitHub).
 *
 * a11y: skip link to "How it works" lives at the top of the page-level
 * landing component (not here) so it's the very first focusable element.
 */
import Link from "next/link";

import { BrandMark } from "@/components/marketing/brand-mark";
import { GITHUB_URL } from "@/components/marketing/links";

type HeroProps = {
  botUrl: string;
  tagline: string;
  subtitle: string;
  openInTelegramLabel: string;
  viewOnGitHubLabel: string;
};

export function Hero({
  botUrl,
  tagline,
  subtitle,
  openInTelegramLabel,
  viewOnGitHubLabel,
}: HeroProps) {
  return (
    <section
      aria-label="listgram"
      style={{
        padding: "var(--lg-sp-12) var(--lg-sp-4) var(--lg-sp-10)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--lg-sp-6)",
        textAlign: "center",
      }}
    >
      <BrandMark size={72} ariaLabel="listgram" />

      <span
        className="lg-wordmark"
        style={{
          fontSize: "var(--lg-fs-3xl)",
          color: "var(--lg-ink-deep)",
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
          maxWidth: 640,
        }}
      >
        {tagline}
      </h1>

      <p
        style={{
          fontSize: "var(--lg-fs-xl)",
          color: "var(--lg-muted-fg)",
          lineHeight: 1.5,
          maxWidth: 560,
        }}
      >
        {subtitle}
      </p>

      <div
        style={{
          display: "flex",
          gap: "var(--lg-sp-3)",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
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
          {openInTelegramLabel}
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--lg-sp-2)",
            padding: "var(--lg-sp-3) var(--lg-sp-6)",
            minHeight: "var(--lg-tap-target)",
            borderRadius: "var(--lg-r-full)",
            border: "1px solid var(--lg-border)",
            background: "transparent",
            color: "var(--lg-fg)",
            fontWeight: "var(--lg-fw-semibold)",
            textDecoration: "none",
          }}
        >
          {viewOnGitHubLabel}
        </a>
      </div>
    </section>
  );
}
