import { DemoChat } from "@/components/marketing/DemoChat";
import { Hero } from "@/components/marketing/Hero";
import { LinkCards } from "@/components/marketing/LinkCards";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = {
  title: "listbull — Telegram-native AI to-do bot",
  description:
    "A Telegram bot for your to-dos. Bring your own OpenRouter key, or use the operator's free tier. Open source, MIT-licensed, self-hostable.",
};

export default function MarketingHome() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <DemoChat />
        <LinkCards />
      </main>
      <SiteFooter />
    </>
  );
}
