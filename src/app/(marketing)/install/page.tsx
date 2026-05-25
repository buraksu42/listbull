import {
  ArrowRightIcon,
  GitHubIcon,
} from "@/components/marketing/BrandMark";
import { InstallContent } from "@/components/marketing/InstallContent";
import { PageHero } from "@/components/marketing/PageHero";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = {
  title: "Install — listbull",
  description:
    "Self-host listbull in twelve steps on any Docker host. BotFather setup, DNS, secrets, reverse proxy, migrations, webhook — in the correct order.",
};

export default function InstallPage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main">
        <PageHero
          eyebrow="Install"
          title="Self-host on a 5€ VPS in 30 minutes."
          lead="Twelve steps, in the right order. Most are Telegram admin (BotFather), the rest are Docker. The BotFather privacy + groups switches come BEFORE you add the bot anywhere — that's the order that avoids the silent-voice-failure trap."
          ctas={
            <>
              <a
                className="btn btn-primary"
                href="https://github.com/buraksu42/listbull"
                target="_blank"
                rel="noopener noreferrer"
              >
                <GitHubIcon />
                Repo on GitHub
              </a>
              <a className="text-link" href="/features">
                See features first
                <ArrowRightIcon />
              </a>
            </>
          }
        />
        <InstallContent />
      </main>
      <SiteFooter />
    </>
  );
}
