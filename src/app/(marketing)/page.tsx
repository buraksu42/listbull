import { Footer } from "@/components/marketing/footer";
import { FeaturesGrid } from "@/components/marketing/features-grid";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import {
  PricingGrid,
  buildDefaultTiers,
} from "@/components/marketing/pricing-grid";
import {
  DEFAULT_AUDIENCES,
  WhoItsFor,
} from "@/components/marketing/who-its-for";
import { detectMarketingCurrency } from "@/lib/marketing/pricing";
import { env } from "@/lib/env";

export const metadata = {
  title: "listbull — Telegram-native AI list assistant for households + teams",
  description:
    "Free for solo, $5/mo for your group, $15/mo for your team. Open source, self-hostable, BYOK.",
};

/**
 * Marketing landing — Phase 5 reframe for the blur audience
 * (households + roommates + freelancer pairs + small offices).
 *
 * Light-only surface. Pricing is locale-aware (TRY for tr-*, USD
 * otherwise) — read server-side from Accept-Language so first paint
 * matches what the visitor expects without a client-side flicker.
 *
 * Anti-list strict (handoff/specs/design.md): no glassmorphism, no
 * gradient text, no neon glow, no stock illustrations, no Asana-
 * style "trusted by Fortune 500" logo wall, no countdown timers, no
 * decorative line illustrations.
 */
export default async function MarketingHome() {
  const botUsername = env.TELEGRAM_BOT_USERNAME ?? "listbull_bot";
  const botUrl = `https://t.me/${botUsername}?start=marketing`;
  const currency = await detectMarketingCurrency();
  const tiers = buildDefaultTiers(currency, botUrl);

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
          tagline="Your group's lists, in Telegram. With AI."
          subtitle="A chatty bot for the way real groups work — families splitting chores, housemates sharing groceries, freelancer pairs running side projects, small offices tracking shared work. Free for solo, paid for your group."
          openInTelegramLabel="Open in Telegram"
          viewOnGitHubLabel="View on GitHub"
        />

        <WhoItsFor heading="Who it's for" audiences={DEFAULT_AUDIENCES} />

        <HowItWorks
          heading="How it works"
          steps={[
            {
              title: "Open the bot",
              body: "Start a chat with @listbull_bot. Get an Inbox + Personal workspace automatically.",
            },
            {
              title: "Capture by chat or tap",
              body: 'Type "süt al" or open the Mini App and tap. Both stay in sync within 5 seconds.',
            },
            {
              title: "Invite your group",
              body: "Add household / roommates / teammates by @username. Workspace-wide or per-list — your call.",
            },
          ]}
        />

        <FeaturesGrid
          heading="What it does well"
          features={[
            {
              title: "Workspaces, not just lists",
              body: "Personal workspace + shared ones for the household / team. Switch by chat or tap; the bot remembers context.",
            },
            {
              title: "Talk to it like a friend",
              body: "Plain Turkish or English. The bot reads intent and creates, edits, completes, schedules, or assigns for you.",
            },
            {
              title: "Roles + audit",
              body: "Owner, admin, editor, viewer, guest. Every change has an actor + timestamp. Restore deleted items for 30 days.",
            },
            {
              title: "Bring your own AI key",
              body: "BYOK with OpenRouter — your usage, your bill, your model choice. Encrypted at rest with AES-256-GCM.",
            },
            {
              title: "Open source, self-hostable",
              body: "Docker Compose, Postgres, Next.js. Run it on your own VPS in under 15 minutes.",
            },
            {
              title: "Native to Telegram",
              body: "Mini App inherits Telegram's theme; uses MainButton + BackButton. Reminders DM. No webview tax.",
            },
          ]}
        />

        <PricingGrid
          heading="Pricing"
          subheading={
            currency === "TRY"
              ? "İstediğin zaman iptal et. KDV dahil."
              : "Cancel anytime."
          }
          tiers={tiers}
        />

        {/* Self-hostable callout strip */}
        <section
          style={{
            padding: "var(--lb-sp-10) var(--lb-sp-6)",
            background: "var(--lb-card)",
            borderTop: "1px solid var(--lb-border)",
            borderBottom: "1px solid var(--lb-border)",
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <h2
              style={{
                fontSize: "var(--lb-fs-2xl)",
                fontWeight: "var(--lb-fw-semibold)",
                marginBottom: "var(--lb-sp-3)",
              }}
            >
              Run your own listbull
            </h2>
            <p
              style={{
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-base)",
                lineHeight: 1.6,
              }}
            >
              MIT licensed, Docker Compose, Postgres + Next.js. Bring your
              own OpenRouter key. Self-host on a $5 VPS in under 15
              minutes — same features as cloud.
            </p>
          </div>
        </section>

        <Footer
          hostedLabel="Hosted on Hetzner — Dokploy"
          licenseLabel="MIT licensed · open source"
          copyrightLabel="© 2026 listbull"
        />
      </main>
    </>
  );
}
