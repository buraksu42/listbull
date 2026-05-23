import {
  ArrowRightIcon,
  TelegramIcon,
} from "@/components/marketing/BrandMark";
import { CommandList } from "@/components/marketing/CommandList";
import { PageHero } from "@/components/marketing/PageHero";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { WorkedExamples } from "@/components/marketing/WorkedExamples";

export const metadata = {
  title: "Commands — listbull",
  description:
    "Twelve slash commands and four worked example flows for the listbull Telegram bot. Matches the live setMyCommands menu exactly.",
};

export default function CommandsPage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main">
        <PageHero
          eyebrow="Commands"
          title="The full slash-command reference."
          lead="Twelve commands match the Telegram menu one-to-one. Plus natural-language — type anything, the bot figures out whether it's a to-do, a reminder, a question, or chat."
          ctas={
            <>
              <a
                className="btn btn-primary"
                href="https://t.me/listbull_bot"
                target="_blank"
                rel="noopener noreferrer"
              >
                <TelegramIcon />
                Open @listbull_bot
              </a>
              <a className="text-link" href="/features">
                See features
                <ArrowRightIcon />
              </a>
            </>
          }
        />
        <section className="section-block" style={{ paddingTop: 0 }}>
          <div className="container">
            <CommandList />
          </div>
        </section>
        <WorkedExamples />
      </main>
      <SiteFooter />
    </>
  );
}
