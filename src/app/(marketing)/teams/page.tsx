import {
  ArrowRightIcon,
  TelegramIcon,
} from "@/components/marketing/BrandMark";
import { PageHero } from "@/components/marketing/PageHero";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { TeamsContent } from "@/components/marketing/TeamsContent";

export const metadata = {
  title: "Teams — listbull",
  description:
    "A to-do app that lives in your team's Telegram group. Tag-based assignment, group-aware reminders, ambient voice transcription, shared password vault. One OpenRouter key per group, optional.",
};

export default function TeamsPage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main">
        <PageHero
          eyebrow="Teams"
          title="A to-do app for small teams. Lives in your group chat."
          lead="Pin @listbull_bot to the Telegram group your team already uses. Items, reminders, voice notes, and a shared password vault — all chat-scoped. No new login, no browser tab, no per-user permissions to babysit."
          ctas={
            <>
              <a
                className="btn btn-primary"
                href="https://t.me/listbull_bot"
                target="_blank"
                rel="noopener noreferrer"
              >
                <TelegramIcon />
                Try @listbull_bot
              </a>
              <a className="text-link" href="/commands">
                See commands
                <ArrowRightIcon />
              </a>
            </>
          }
        />
        <TeamsContent />
      </main>
      <SiteFooter />
    </>
  );
}
