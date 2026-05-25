import { PageHero } from "@/components/marketing/PageHero";
import { SecurityClaims } from "@/components/marketing/SecurityClaims";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = {
  title: "Security — listbull",
  description:
    "How listbull encrypts passwords, isolates chats, and authenticates webhooks. Every claim linked to source on GitHub.",
};

export default function SecurityPage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main">
        <PageHero
          eyebrow="Security"
          title="How we handle your data, linked to source."
          lead="listbull stores your /password secrets and OpenRouter keys AES-256-GCM-encrypted; scopes every read and write to your chat; and authenticates the Telegram webhook with a constant-time secret check. Each claim below links to the actual code so you can verify it. See the disclaimer at the bottom for what's out of scope."
        />
        <section style={{ padding: "0 0 56px" }}>
          <div className="container">
            <p className="security-hero-links">
              <a
                href="https://github.com/buraksu42/listbull/blob/main/SECURITY.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                Full write-up: SECURITY.md ↗
              </a>
            </p>
          </div>
        </section>
        <SecurityClaims />
      </main>
      <SiteFooter />
    </>
  );
}
