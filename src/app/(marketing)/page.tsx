import { Footer } from "@/components/marketing/footer";
import { FeaturesGrid } from "@/components/marketing/features-grid";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { env } from "@/lib/env";

export const metadata = {
  title: "listbull — Telegram-native AI list assistant",
  description:
    "Open source, self-hostable, BYOK. Chat your todos into Telegram, manage in a Mini App.",
};

/**
 * Marketing landing — light-only surface.
 *
 * Rendered statically (no auth, no theme adapter, no next-intl client
 * provider — visitors aren't authed and marketing copy is English-only
 * by default per design.md). Components are server components consuming
 * raw strings; if Phase 5 wants TR-localized marketing copy, the strings
 * are already extracted in `messages/{tr,en}.json` under `marketing.*`.
 *
 * Anti-list strict (handoff/specs/design.md): no glassmorphism, no
 * gradient text, no neon glow, no stock illustrations, no cosmic
 * imagery, no skeumorphic shadows. Just type, color, and shape.
 */
export default function MarketingHome() {
  const botUsername = env.TELEGRAM_BOT_USERNAME ?? "listbull_bot";
  const botUrl =
    env.NEXT_PUBLIC_ENV === "production"
      ? `https://t.me/${botUsername}?start=marketing`
      : `https://t.me/${botUsername}?start=marketing`;

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
          botUrl={botUrl}
          tagline="Your todos, in Telegram."
          subtitle="A chatty bot that captures and manages your lists. A Mini App for when you want to see them. Bring your own AI key — open source, self-hostable."
          openInTelegramLabel="Open in Telegram"
          viewOnGitHubLabel="View on GitHub"
        />

        <FeaturesGrid
          heading="What it does well"
          features={[
            {
              title: "Talk to it like a friend",
              body: "Plain Turkish or English — the bot reads intent and creates, edits, completes, schedules, or shares for you.",
            },
            {
              title: "Share lists, not chats",
              body: "Per-list invites by Telegram username. Editors and viewers, no group bots.",
            },
            {
              title: "Bring your own AI key",
              body: "BYOK with OpenRouter — your usage, your bill, your model choice. Encrypted at rest with AES-256-GCM.",
            },
            {
              title: "Open source, self-hostable",
              body: "Docker Compose, Postgres, Next.js. Run it on your own Hetzner box in under 15 minutes.",
            },
            {
              title: "Native to Telegram",
              body: "Mini App inherits Telegram's theme and uses the native MainButton + BackButton. No webview tax.",
            },
            {
              title: "Works offline-ish",
              body: "Optimistic UI on every action. 5-second polling on shared lists. Snappy regardless of network.",
            },
          ]}
        />

        <HowItWorks
          heading="How it works"
          steps={[
            {
              title: "Open the bot",
              body: "Start a chat with @listbull_bot. The bot creates your Inbox automatically.",
            },
            {
              title: "Talk or tap",
              body: 'Type "süt al" or open the Mini App and tap. Both stay in sync within 5 seconds.',
            },
            {
              title: "Share when you want",
              body: "Invite housemates by @username. They get a one-tap accept link in chat.",
            },
          ]}
        />

        <Footer
          hostedLabel="Hosted on Hetzner — Dokploy"
          licenseLabel="MIT licensed · open source"
          copyrightLabel="© 2026 listbull"
        />
      </main>
    </>
  );
}
