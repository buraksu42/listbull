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
          title="Every guarantee, linked to source."
          lead="listbull stores your /password secrets and OpenRouter keys AES-256-GCM-encrypted; isolates every chat's data; and authenticates the Telegram webhook with a constant-time secret check. Click any link below to verify against the actual code."
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
              <a
                href="https://github.com/buraksu42/listbull/security/advisories/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                Report privately via GitHub Security Advisories ↗
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
