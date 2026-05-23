import {
  ArrowRightIcon,
  TelegramIcon,
} from "@/components/marketing/BrandMark";
import { FeatureGrid } from "@/components/marketing/FeatureGrid";
import { PageHero } from "@/components/marketing/PageHero";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = {
  title: "Features — listbull",
  description:
    "Everything the listbull Telegram bot does today. Six capabilities, all shipped — no waitlist.",
};

export default function FeaturesPage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main">
        <PageHero
          eyebrow="Features"
          title="Everything the bot does, today."
          lead="No 'coming soon', no waitlist, no roadmap-only headers. Six capabilities, live on the bot right now."
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
        <FeatureGrid />
      </main>
      <SiteFooter />
    </>
  );
}
