import Link from "next/link";

import { FeaturesGrid } from "@/components/marketing/features-grid";
import { Footer } from "@/components/marketing/footer";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";

export const metadata = {
  title: "listbull — open-source Telegram-native AI list assistant",
  description:
    "Self-host in 15 minutes. Bring your own OpenRouter key. MIT licensed.",
};

/**
 * Marketing homepage — DIY-first OSS framing.
 *
 * Light-only surface. Primary CTA points at `/install`, not a hosted
 * bot; the hosted demo at @listbull_bot is a footer convenience. AI
 * cost + privacy + content liability stay with each self-hoster.
 *
 * Anti-list strict (handoff/specs/design.md): no glassmorphism, no
 * gradient text, no neon glow, no stock illustrations, no logo wall,
 * no countdown timers, no decorative line illustrations. Elegance
 * comes from typography hierarchy, generous whitespace, and brand
 * mark presence — not new effects.
 */
export default function MarketingHome() {
  return (
    <>
      {/* Skip link — first focusable, not visible until focus. */}
      <a href="#how-it-works" className="lb-skip-link">
        Skip to how it works
      </a>

      <main
        style={{
          minHeight: "100dvh",
          background: "var(--lb-bg)",
          color: "var(--lb-fg)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Hero
          tagline="AI lists, on your Telegram, on your server."
          subtitle="Self-host the Telegram-native AI list assistant. Talk to it like a friend, share lists with your group, run reminders — all on infrastructure you control."
          deployLabel="Deploy your own — 15 min"
          viewOnGitHubLabel="View on GitHub"
        />

        <HowItWorks
          heading="How it works"
          steps={[
            {
              title: "Deploy on your server",
              body: "Docker Compose, Postgres, Next.js. One env file, one migration, one webhook. The /install guide walks each step.",
            },
            {
              title: "Connect your Telegram bot",
              body: 'Create a bot via @BotFather, paste the token. Type "süt al" to your bot — it parses intent, creates the item, confirms in your language.',
            },
            {
              title: "Invite your group",
              body: "Add household / roommates / teammates by @username. Workspace-wide or per-list, with roles (owner / admin / editor / viewer / guest).",
            },
          ]}
        />

        <FeaturesGrid
          heading="What you get"
          features={[
            {
              title: "Talk to it like a friend",
              body: "Plain Turkish or English. Voice, forwards, photos, inline mode in any chat. The bot reads intent and creates, edits, completes, schedules, or assigns for you.",
            },
            {
              title: "Sharing with roles + audit",
              body: "Workspaces with 5 roles, lists with 3. Every change has an actor + timestamp. Restore deleted items for 30 days. Reminders DM the assignee at 60-second resolution.",
            },
            {
              title: "Your key, your data, your server",
              body: "BYOK via OpenRouter (Claude / GPT / Gemini, 13 models in the picker). Encrypted at rest with AES-256-GCM. MIT licensed, no telemetry by default, no managed-cloud dependencies.",
            },
          ]}
        />

        {/* Install teaser — second-prominent block, directly reinforces the
            hero CTA. Card-style, generous padding, single clear next action. */}
        <section
          aria-labelledby="install-teaser-heading"
          style={{
            padding: "var(--lb-sp-12) var(--lb-sp-6)",
            background: "var(--lb-card)",
            borderTop: "1px solid var(--lb-border)",
            borderBottom: "1px solid var(--lb-border)",
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <h2
              id="install-teaser-heading"
              style={{
                fontSize: "var(--lb-fs-2xl)",
                fontWeight: "var(--lb-fw-semibold)",
                marginBottom: "var(--lb-sp-3)",
              }}
            >
              Run it on your own VPS in 15 minutes
            </h2>
            <p
              style={{
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-base)",
                lineHeight: 1.6,
                marginBottom: "var(--lb-sp-6)",
              }}
            >
              No Vercel lock-in, no managed Postgres, no SaaS billing. A
              €5/mo VPS handles a household; a €20/mo box handles a
              5–15 person team. The /install guide walks you through env
              setup, BotFather wiring, and the deploy command.
            </p>
            <div
              style={{
                display: "flex",
                gap: "var(--lb-sp-3)",
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <Link
                href="/install"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "var(--lb-sp-3) var(--lb-sp-6)",
                  minHeight: "var(--lb-tap-target)",
                  borderRadius: "var(--lb-r-full)",
                  background: "var(--lb-accent)",
                  color: "var(--lb-accent-fg)",
                  fontWeight: "var(--lb-fw-semibold)",
                  textDecoration: "none",
                }}
              >
                Read the install guide
              </Link>
              <Link
                href="/features"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "var(--lb-sp-3) var(--lb-sp-6)",
                  minHeight: "var(--lb-tap-target)",
                  borderRadius: "var(--lb-r-full)",
                  border: "1px solid var(--lb-border)",
                  background: "transparent",
                  color: "var(--lb-fg)",
                  fontWeight: "var(--lb-fw-semibold)",
                  textDecoration: "none",
                }}
              >
                See all features
              </Link>
            </div>
          </div>
        </section>

        <Footer
          hostedLabel="Self-host: Docker Compose, Postgres, Next.js"
          licenseLabel="MIT licensed · open source"
          copyrightLabel="© 2026 listbull"
        />
      </main>
    </>
  );
}
