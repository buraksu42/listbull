import { CommandList } from "@/components/marketing/CommandList";
import { DemoGif } from "@/components/marketing/DemoGif";
import { FeatureGrid } from "@/components/marketing/FeatureGrid";
import { Footer } from "@/components/marketing/Footer";
import { Hero } from "@/components/marketing/Hero";
import { ScreenshotMosaic } from "@/components/marketing/ScreenshotMosaic";
import { TestimonialsPlaceholder } from "@/components/marketing/TestimonialsPlaceholder";

export const metadata = {
  title: "listbull — Telegram-native AI to-do bot",
  description:
    "Open-source Telegram bot for to-dos, reminders, voice notes, and encrypted passwords. Self-host in 15 minutes; BYOK or free tier.",
};

/**
 * Marketing landing (Phase 17 chat-only).
 *
 * Sections compose top-to-bottom: hero CTA → demo loop → feature
 * grid → screenshot mosaic → slash-command reference → testimonials
 * placeholder → footer. Light-only (parent layout sets data-theme).
 */
export default function MarketingHome() {
  return (
    <main
      id="lb-main"
      className="flex min-h-dvh flex-col"
      style={{ background: "var(--lb-bg)", color: "var(--lb-fg)" }}
    >
      <Hero />
      <DemoGif />
      <FeatureGrid />
      <ScreenshotMosaic />
      <CommandList />
      <TestimonialsPlaceholder />
      <Footer />
    </main>
  );
}
